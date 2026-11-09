// Client for the seat cluster: a private kube-apiserver + kube-scheduler + KWOK
// (deploy/seats.yaml). Rooms are fake Nodes, attendees are Pods. The real,
// unmodified kube-scheduler decides who sits where; this file only translates
// people into Pods and scheduler answers into plain English.
//
// Logs carry attendee ids only, never names or other personal data.

const SEATS_URL = process.env.SEATS_URL || 'http://seats:8080';
const NS = 'default';
const SEAT = 'conf.io/seat';
const CAPACITY = 'conf.io/capacity';
const DOOR = 'conf.io/door';
let statsCache = null; // { at, value }: room stats shared by status polls

async function api(method, path, body, contentType = 'application/json') {
  const res = await fetch(SEATS_URL + path, {
    method,
    headers: body ? { 'content-type': contentType } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`${method} ${path}: ${res.status} ${data && data.message}`);
    err.status = res.status;
    err.upstream = true; // seat-cluster detail: log it, never send it to the browser
    throw err;
  }
  return data;
}

// --- Rooms (Nodes) ----------------------------------------------------------

function roomNode(name, room, talk, seats, pool) {
  const labels = {
    'conf.io/room': room.id,
    'conf.io/talk': talk,
    'conf.io/pool': pool,
    'access.conf.io/step-free': String(room.stepFree),
    'access.conf.io/captions': String(room.captions),
    'type': 'kwok',
  };
  return {
    apiVersion: 'v1',
    kind: 'Node',
    metadata: {
      name,
      labels,
      // KWOK manages Nodes with this annotation: marks them Ready and fakes Pods as Running.
      // conf.io/capacity: the room's seats; conf.io/door: people counted in at the door.
      annotations: { 'kwok.x-k8s.io/node': 'fake', [CAPACITY]: String(seats), [DOOR]: '0' },
    },
    spec: pool === 'accessible'
      ? { taints: [{ key: 'conf.io/accessible-seats', value: 'true', effect: 'NoSchedule' }] }
      : {},
    status: {
      capacity: { cpu: '1000', memory: '1000Gi', pods: '1000', [SEAT]: String(seats) },
      allocatable: { cpu: '1000', memory: '1000Gi', pods: '1000', [SEAT]: String(seats) },
    },
  };
}

// Each room is two Nodes: general seats, and a tainted pool of accessible seats
// that only people who need them can use.
async function ensureRooms(rooms) {
  // The in-pod seat cluster runs no ServiceAccount controller, and the apiserver's
  // ServiceAccount admission refuses Pods until `default` exists. Create it ourselves.
  try {
    await api('POST', `/api/v1/namespaces/${NS}/serviceaccounts`, {
      apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: 'default' }, automountServiceAccountToken: false,
    });
  } catch (e) {
    if (e.status !== 409) throw e;
  }
  for (const room of rooms) {
    const general = roomNode(`room-${room.id}`, room, room.talk, room.seats - room.accessibleSeats, 'general');
    const access = roomNode(`room-${room.id}-access`, room, room.talk, room.accessibleSeats, 'accessible');
    for (const node of [general, access]) {
      try {
        await api('POST', '/api/v1/nodes', node);
      } catch (e) {
        if (e.status !== 409) throw e; // already there from an earlier start
      }
      // TaintNodesByCondition admission adds node.kubernetes.io/not-ready to every new
      // Node, and only the controller-manager (absent in the seat pod) removes it. Set
      // exactly the taints the room should have.
      await api('PATCH', `/api/v1/nodes/${node.metadata.name}`,
        { spec: { taints: node.spec.taints || [] } }, 'application/merge-patch+json');
    }
  }
}

// --- Live occupancy (door clicker) --------------------------------------------
//
// A volunteer at the door counts people in and out. That count is the room's real
// occupancy. Some of those people came through kubeseat (their Pods are bound to the
// room); the rest are walk-ins. The scheduler may only hand out what's really left:
//
//   seats the scheduler sees = capacity - walk-ins,  walk-ins = max(0, door - app attendees)
//
// (never below the app attendees already bound there). When the door count reaches
// capacity, the room takes no new recommendations and attendees are steered to backups.

const nodeName = (roomId, pool) => (pool === 'accessible' ? `room-${roomId}-access` : `room-${roomId}`);
const ann = (n, k, dflt) => {
  const v = Number(n.metadata.annotations?.[k]);
  return Number.isFinite(v) ? v : dflt;
};

async function applyOccupancy(name) {
  const n = await api('GET', `/api/v1/nodes/${name}`);
  const used = (await api('GET', `/api/v1/namespaces/${NS}/pods?fieldSelector=spec.nodeName=${name}`)).items.filter(live).length;
  const capacity = ann(n, CAPACITY, Number(n.status.allocatable[SEAT] || 0));
  const door = ann(n, DOOR, 0);
  const walkIns = Math.max(0, door - used);
  const s = String(Math.max(used, capacity - walkIns));
  await api('PATCH', `/api/v1/nodes/${name}/status`,
    { status: { capacity: { [SEAT]: s }, allocatable: { [SEAT]: s } } },
    'application/merge-patch+json');
}

// Change one annotation safely when two app replicas (two organizers) write at once.
async function updateAnnotation(name, key, fn) {
  for (let attempt = 1; ; attempt++) {
    const n = await api('GET', `/api/v1/nodes/${name}`);
    const next = fn(ann(n, key, key === CAPACITY ? Number(n.status.allocatable[SEAT] || 0) : 0));
    try {
      await api('PATCH', `/api/v1/nodes/${name}`,
        { metadata: { resourceVersion: n.metadata.resourceVersion, annotations: { [key]: String(next) } } },
        'application/merge-patch+json');
      return next;
    } catch (e) {
      if (e.status !== 409 || attempt >= 5) throw e;
    }
  }
}

async function setSeats(roomId, pool, seats) {
  const name = nodeName(roomId, pool);
  await updateAnnotation(name, CAPACITY, () => seats);
  await applyOccupancy(name);
}

// The door clicker: +delta, or set an absolute count. Returns the new count.
async function countDoor(roomId, { delta, count }) {
  const name = nodeName(roomId, 'general');
  const door = await updateAnnotation(name, DOOR, (cur) =>
    Math.min(100000, Math.max(0, Number.isInteger(count) ? count : cur + delta)));
  await applyOccupancy(name);
  statsCache = null;
  console.log(`door count room=${roomId} count=${door}`);
  return door;
}

// Swap the talks in two rooms (e.g. move a packed talk to a bigger room).
// Node affinity is IgnoredDuringExecution, so relabelling alone would leave people
// seated in the room their talk just left (and could put a step-free need in a room
// without step-free access). So everyone seated in either room is re-queued, earliest
// request first, and the scheduler seats them again against the new labels.
// Waitlisted Pods whose must-see talk now has free seats get seated too.
async function swapTalks(roomA, roomB) {
  const nodes = (await api('GET', '/api/v1/nodes?labelSelector=conf.io/room')).items;
  const talkOf = (id) => nodes.find((n) => n.metadata.labels['conf.io/room'] === id)?.metadata.labels['conf.io/talk'];
  const a = talkOf(roomA);
  const b = talkOf(roomB);
  if (!a || !b) throw Object.assign(new Error('unknown room'), { status: 404 });
  const swapped = new Set();
  for (const n of nodes) {
    const room = n.metadata.labels['conf.io/room'];
    if (room !== roomA && room !== roomB) continue;
    swapped.add(n.metadata.name);
    await api('PATCH', `/api/v1/nodes/${n.metadata.name}`,
      { metadata: { labels: { 'conf.io/talk': room === roomA ? b : a } } },
      'application/merge-patch+json');
  }

  const seated = (await api('GET', `/api/v1/namespaces/${NS}/pods`)).items
    .filter((p) => live(p) && swapped.has(p.spec.nodeName))
    .sort((x, y) => requestedAt(x).localeCompare(requestedAt(y)));
  // One at a time (delete, then create) took ~16 s for 425 attendees live: the long
  // POST /api/swap trace in Dash0. Deletes run in parallel batches; creates stay
  // strictly one by one in request order, so the scheduler's queue (priority, then
  // arrival) still seats the earliest request first when the target room is short.
  const BATCH = 10;
  for (let i = 0; i < seated.length; i += BATCH) {
    await Promise.all(seated.slice(i, i + BATCH).map((p) => api('DELETE',
      `/api/v1/namespaces/${NS}/pods/${p.metadata.name}?gracePeriodSeconds=0`).catch((e) => {
      if (e.status !== 404) throw e; // already gone is fine
    })));
  }
  for (const p of seated) {
    const { nodeName, ...spec } = p.spec;
    // A NEW name, never the old one: KWOK finishes the old Pod's deletion by name a
    // moment later, and with a reused name it deleted the re-created Pod instead
    // (8 of 1,000 attendees lost their seat in the first load test).
    await createWithRetry({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: podName(p.metadata.labels['conf.io/attendee']), labels: p.metadata.labels, annotations: p.metadata.annotations },
      spec,
    });
  }
  console.log(`talks swapped rooms=${roomA},${roomB} reseated=${seated.length}`);
  return { reseated: seated.length };
}

// Every Pod an attendee ever gets has a unique name; the attendee is found by the
// conf.io/attendee label. Names are never reused (see swapTalks).
let podSeq = 0;
function podName(id) {
  podSeq = (podSeq + 1) % 1296;
  return `a-${id}-${Date.now().toString(36)}${podSeq.toString(36).padStart(2, '0')}`;
}

const live = (p) => !p.metadata.deletionTimestamp;

// The attendee's current Pod (newest live one), or null.
async function findPod(id) {
  const pods = (await api('GET', `/api/v1/namespaces/${NS}/pods?labelSelector=conf.io/attendee=${id}`)).items.filter(live);
  pods.sort((a, b) => b.metadata.creationTimestamp.localeCompare(a.metadata.creationTimestamp) || b.metadata.name.localeCompare(a.metadata.name));
  return pods[0] || null;
}

// Once an attendee's Pod is deleted they must get a new one, so retry transient
// failures. A 409 on a retry means an earlier attempt (e.g. one that timed out
// client-side) did create it: that's success. Other 4xx are not retried.
async function createWithRetry(pod) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await api('POST', `/api/v1/namespaces/${NS}/pods`, pod);
    } catch (e) {
      if (attempt > 1 && e.status === 409) return null;
      const transient = !e.status || e.status === 429 || e.status >= 500;
      if (!transient || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
}

// creationTimestamp is per-second; the request annotation has milliseconds.
function requestedAt(p) {
  return p.metadata.annotations?.['conf.io/requested-at'] || p.metadata.creationTimestamp;
}

// --- Attendees (Pods) -------------------------------------------------------

// interests: [{ talk, weight }] with integer weights 1-100 (scaled from Elastic scores).
// mustSee: talk id or null (REQUIRED affinity: waitlisted if full).
// needs: { stepFree, captions, accessibleSeat } (REQUIRED affinity; never preferred).
function attendeePod(id, { interests = [], mustSee = null, needs = {} }) {
  const required = [];
  if (mustSee) required.push({ key: 'conf.io/talk', operator: 'In', values: [mustSee] });
  if (needs.stepFree) required.push({ key: 'access.conf.io/step-free', operator: 'In', values: ['true'] });
  if (needs.captions) required.push({ key: 'access.conf.io/captions', operator: 'In', values: ['true'] });

  const preferred = interests
    .filter((i) => i.talk && Number.isInteger(i.weight) && i.weight >= 1 && i.weight <= 100)
    .map((i) => ({ weight: i.weight, preference: { matchExpressions: [{ key: 'conf.io/talk', operator: 'In', values: [i.talk] }] } }));

  const tolerations = [];
  if (needs.accessibleSeat) {
    tolerations.push({ key: 'conf.io/accessible-seats', operator: 'Equal', value: 'true', effect: 'NoSchedule' });
    // Steer into the pool, so an accessible-seat holder doesn't take a general seat.
    preferred.push({ weight: 100, preference: { matchExpressions: [{ key: 'conf.io/pool', operator: 'In', values: ['accessible'] }] } });
  }

  const nodeAffinity = {};
  if (required.length) nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution = { nodeSelectorTerms: [{ matchExpressions: required }] };
  if (preferred.length) nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution = preferred;

  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: podName(id),
      labels: { 'conf.io/attendee': id, ...(mustSee ? { 'conf.io/must-see': mustSee } : {}) },
      annotations: { 'conf.io/requested-at': new Date().toISOString() },
    },
    spec: {
      schedulerName: 'default-scheduler',
      automountServiceAccountToken: false,
      affinity: Object.keys(nodeAffinity).length ? { nodeAffinity } : undefined,
      tolerations,
      containers: [{
        name: 'seat',
        image: 'conf.io/seat', // never pulled: KWOK fakes the container
        resources: { requests: { [SEAT]: '1' }, limits: { [SEAT]: '1' } },
      }],
    },
  };
}

async function requestSeat(id, prefs) {
  await api('POST', `/api/v1/namespaces/${NS}/pods`, attendeePod(id, prefs));
  console.log(`seat requested attendee=${id}`);
}

async function cancelSeat(id) {
  // Every Pod of this attendee (normally one).
  await api('DELETE', `/api/v1/namespaces/${NS}/pods?labelSelector=conf.io/attendee=${id}&gracePeriodSeconds=0`);
  console.log(`seat released attendee=${id}`);
}

// Turn the scheduler's verdict into something a first-timer understands.
function explain(pod, needs = {}) {
  const cond = (pod.status?.conditions || []).find((c) => c.type === 'PodScheduled');
  const msg = cond?.message || '';
  if (msg.includes(`Insufficient ${SEAT}`)) return 'Room full: you are on the waitlist and will be seated if a seat frees up.';
  if (msg.includes('affinity/selector')) {
    if (needs.stepFree || needs.captions) return 'No room for this talk meets your access needs yet. An organizer has been flagged.';
    return 'Your must-see talk is not in any room right now.';
  }
  if (msg.includes('untolerated taint')) return 'Only accessible seats are left.';
  return 'Finding you a seat...';
}

async function seatStatus(id) {
  const pod = await findPod(id);
  if (!pod) return null;
  const node = pod.spec.nodeName;
  const stats = await roomStatsCached();
  const options = optionsFor(pod, stats);
  if (node) {
    const n = await api('GET', `/api/v1/nodes/${node}`);
    const room = n.metadata.labels['conf.io/room'];
    return {
      state: 'seated',
      room,
      talk: n.metadata.labels['conf.io/talk'],
      accessibleSeat: n.metadata.labels['conf.io/pool'] === 'accessible',
      // Filled up at the door since we recommended it: send them to a backup.
      roomFull: !!stats.rooms.find((r) => r.room === room)?.full,
      options,
    };
  }
  const needs = {
    stepFree: JSON.stringify(pod.spec.affinity || {}).includes('step-free'),
    captions: JSON.stringify(pod.spec.affinity || {}).includes('captions'),
  };
  const out = { state: 'waiting', reason: explain(pod, needs), options };
  const mustSee = pod.metadata.labels['conf.io/must-see'];
  if (mustSee) {
    const waiting = (await api('GET', `/api/v1/namespaces/${NS}/pods?labelSelector=conf.io/must-see=${encodeURIComponent(mustSee)}&fieldSelector=spec.nodeName=`)).items.filter(live);
    waiting.sort((a, b) => requestedAt(a).localeCompare(requestedAt(b)));
    out.waitlistPosition = waiting.findIndex((p) => p.metadata.name === pod.metadata.name) + 1;
  }
  return out;
}

// Organizer view: per room, seats used/total in each pool and who is waiting for it.
async function roomStats() {
  const nodes = (await api('GET', '/api/v1/nodes?labelSelector=conf.io/room')).items;
  const pods = (await api('GET', `/api/v1/namespaces/${NS}/pods`)).items.filter(live);
  const used = {};
  let pending = 0;
  const waitingFor = {};
  for (const p of pods) {
    if (p.spec.nodeName) used[p.spec.nodeName] = (used[p.spec.nodeName] || 0) + 1;
    else {
      pending++;
      const t = p.metadata.labels['conf.io/must-see'];
      if (t) waitingFor[t] = (waitingFor[t] || 0) + 1;
    }
  }
  const rooms = {};
  for (const n of nodes) {
    const l = n.metadata.labels;
    const r = (rooms[l['conf.io/room']] ||= {
      room: l['conf.io/room'], talk: l['conf.io/talk'],
      stepFree: l['access.conf.io/step-free'] === 'true', captions: l['access.conf.io/captions'] === 'true',
      general: { used: 0, seats: 0 }, accessible: { used: 0, seats: 0 },
    });
    const pool = r[l['conf.io/pool']];
    pool.seats = Number(n.status.allocatable[SEAT] || 0);
    pool.used = used[n.metadata.name] || 0;
    if (l['conf.io/pool'] === 'general') {
      // Live occupancy from the door clicker.
      r.capacity = ann(n, CAPACITY, pool.seats);
      r.door = ann(n, DOOR, 0);
    }
  }
  const list = Object.values(rooms).map((r) => ({
    ...r,
    full: r.door >= r.capacity,
    waitlist: waitingFor[r.talk] || 0,
  }));
  list.sort((a, b) => a.room.localeCompare(b.room));
  return { rooms: list, pending, attendees: pods.length };
}

// Status polls from every attendee share one fresh-enough read.
async function roomStatsCached(maxAgeMs = 2000) {
  if (statsCache && Date.now() - statsCache.at < maxAgeMs) return statsCache.value;
  const value = await roomStats();
  statsCache = { at: Date.now(), value };
  return value;
}

// Three options for an attendee: where the scheduler placed them ("go"), and two
// backups from their own preferences whose rooms still have space at the door and
// meet their access needs. If their room fills up at the door, they're told to go
// to backup 1.
function optionsFor(pod, stats) {
  const aff = pod.spec.affinity?.nodeAffinity || {};
  const required = (aff.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms?.[0]?.matchExpressions) || [];
  const needs = {
    captions: required.some((e) => e.key === 'access.conf.io/captions'),
    stepFree: required.some((e) => e.key === 'access.conf.io/step-free'),
  };
  const prefs = (aff.preferredDuringSchedulingIgnoredDuringExecution || [])
    .map((p) => ({ weight: p.weight, e: p.preference.matchExpressions[0] }))
    .filter((p) => p.e.key === 'conf.io/talk')
    .sort((a, b) => b.weight - a.weight)
    .map((p) => p.e.values[0]);
  const mustSee = pod.metadata.labels['conf.io/must-see'];
  const byTalk = Object.fromEntries(stats.rooms.map((r) => [r.talk, r]));
  const fits = (r) => r && (!needs.captions || r.captions) && (!needs.stepFree || r.stepFree);
  const view = (r, kind) => ({ kind, talk: r.talk, room: r.room, door: r.door, capacity: r.capacity, full: r.full });

  const bound = pod.spec.nodeName && stats.rooms.find((r) => pod.spec.nodeName.startsWith(`room-${r.room}`)
    && (pod.spec.nodeName === `room-${r.room}` || pod.spec.nodeName === `room-${r.room}-access`));
  const out = [];
  if (bound) out.push(view(bound, 'go'));
  // Backups: own preferences first (the must-see too, if it's not where they're going),
  // then any other open room that meets their needs, emptiest first.
  const order = [...new Set([mustSee, ...prefs].filter(Boolean))];
  const rest = stats.rooms.filter((r) => !order.includes(r.talk)).sort((a, b) => a.door / a.capacity - b.door / b.capacity).map((r) => r.talk);
  for (const t of [...order, ...rest]) {
    if (out.length >= 3) break;
    const r = byTalk[t];
    if (!fits(r) || r.full || out.some((o) => o.talk === t)) continue;
    out.push(view(r, out.length ? 'backup' : 'go'));
  }
  return out;
}

// Seated attendees not yet counted in the time-to-seat metric. Each is claimed with a
// label write guarded by resourceVersion, so with several app replicas exactly one
// replica (the one whose write succeeds) reports it, via onSeated, right after its
// claim succeeds: a later failure in the same pass can't lose it. Re-created Pods
// (talk swap) keep the label, so they aren't counted twice.
// Pods seated before `since` (ms) are claimed without a sample: they were seated
// while this replica wasn't measuring, and now - requestedAt would overstate them.
async function claimNewlySeated(onSeated, since = 0) {
  const pods = (await api('GET', `/api/v1/namespaces/${NS}/pods?labelSelector=!conf.io/recorded&fieldSelector=spec.nodeName!=`)).items;
  for (const p of pods) {
    try {
      await api('PATCH', `/api/v1/namespaces/${NS}/pods/${p.metadata.name}`,
        { metadata: { resourceVersion: p.metadata.resourceVersion, labels: { 'conf.io/recorded': 'true' } } },
        'application/merge-patch+json');
    } catch (e) {
      if (e.status === 409 || e.status === 404) continue; // another replica got it, or it left
      throw e;
    }
    const scheduledAt = Date.parse((p.status?.conditions || []).find((c) => c.type === 'PodScheduled')?.lastTransitionTime || '');
    if (scheduledAt && scheduledAt < since) continue;
    const node = p.spec.nodeName;
    onSeated({
      seconds: Math.max(0, (Date.now() - Date.parse(requestedAt(p))) / 1000),
      room: node.replace(/^room-/, '').replace(/-access$/, ''),
      pool: node.endsWith('-access') ? 'accessible' : 'general',
      mustSee: !!p.metadata.labels['conf.io/must-see'],
    });
  }
}

// The attendee's Pod, trimmed to what explains the seat: request, affinity, result.
async function getPod(id) {
  const p = await findPod(id);
  if (!p) return null;
  const sched = (p.status?.conditions || []).find((c) => c.type === 'PodScheduled');
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: p.metadata.name, labels: p.metadata.labels },
    spec: {
      schedulerName: p.spec.schedulerName,
      ...(p.spec.nodeName ? { nodeName: p.spec.nodeName } : {}),
      affinity: p.spec.affinity,
      tolerations: (p.spec.tolerations || []).filter((t) => t.key?.startsWith('conf.io/')),
      containers: p.spec.containers.map((c) => ({ name: c.name, resources: c.resources })),
    },
    status: {
      phase: p.status?.phase,
      ...(sched ? { conditions: [{ type: 'PodScheduled', status: sched.status, ...(sched.reason ? { reason: sched.reason } : {}), ...(sched.message ? { message: sched.message } : {}) }] } : {}),
    },
  };
}

module.exports = { countDoor, roomStatsCached, getPod, claimNewlySeated, ensureRooms, setSeats, swapTalks, requestSeat, cancelSeat, seatStatus, roomStats, attendeePod };
