// Client for the seat cluster: a private kube-apiserver + kube-scheduler + KWOK
// (deploy/seats.yaml). Rooms are fake Nodes, attendees are Pods. The real,
// unmodified kube-scheduler decides who sits where; this file only translates
// people into Pods and scheduler answers into plain English.
//
// Logs carry attendee ids only, never names or other personal data.

const SEATS_URL = process.env.SEATS_URL || 'http://seats:8080';
const NS = 'default';
const SEAT = 'conf.io/seat';

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
      annotations: { 'kwok.x-k8s.io/node': 'fake' },
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
  for (const room of rooms) {
    const general = roomNode(`room-${room.id}`, room, room.talk, room.seats - room.accessibleSeats, 'general');
    const access = roomNode(`room-${room.id}-access`, room, room.talk, room.accessibleSeats, 'accessible');
    for (const node of [general, access]) {
      try {
        await api('POST', '/api/v1/nodes', node);
      } catch (e) {
        if (e.status !== 409) throw e; // already there from an earlier start
      }
    }
  }
}

async function setSeats(roomId, pool, seats) {
  const name = pool === 'accessible' ? `room-${roomId}-access` : `room-${roomId}`;
  const s = String(seats);
  await api('PATCH', `/api/v1/nodes/${name}/status`,
    { status: { capacity: { [SEAT]: s }, allocatable: { [SEAT]: s } } },
    'application/merge-patch+json');
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
    .filter((p) => swapped.has(p.spec.nodeName))
    .sort((x, y) => requestedAt(x).localeCompare(requestedAt(y)));
  for (const p of seated) {
    await api('DELETE', `/api/v1/namespaces/${NS}/pods/${p.metadata.name}?gracePeriodSeconds=0`);
    const { nodeName, ...spec } = p.spec;
    await api('POST', `/api/v1/namespaces/${NS}/pods`, {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: p.metadata.name, labels: p.metadata.labels, annotations: p.metadata.annotations },
      spec,
    });
  }
  console.log(`talks swapped rooms=${roomA},${roomB} reseated=${seated.length}`);
  return { reseated: seated.length };
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
      name: `a-${id}`,
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
  try {
    await api('DELETE', `/api/v1/namespaces/${NS}/pods/a-${id}?gracePeriodSeconds=0`);
  } catch (e) {
    if (e.status !== 404) throw e;
  }
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
  let pod;
  try {
    pod = await api('GET', `/api/v1/namespaces/${NS}/pods/a-${id}`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
  const node = pod.spec.nodeName;
  if (node) {
    const n = await api('GET', `/api/v1/nodes/${node}`);
    return {
      state: 'seated',
      room: n.metadata.labels['conf.io/room'],
      talk: n.metadata.labels['conf.io/talk'],
      accessibleSeat: n.metadata.labels['conf.io/pool'] === 'accessible',
    };
  }
  const needs = {
    stepFree: JSON.stringify(pod.spec.affinity || {}).includes('step-free'),
    captions: JSON.stringify(pod.spec.affinity || {}).includes('captions'),
  };
  const out = { state: 'waiting', reason: explain(pod, needs) };
  const mustSee = pod.metadata.labels['conf.io/must-see'];
  if (mustSee) {
    const waiting = (await api('GET', `/api/v1/namespaces/${NS}/pods?labelSelector=conf.io/must-see=${encodeURIComponent(mustSee)}&fieldSelector=spec.nodeName=`)).items;
    waiting.sort((a, b) => requestedAt(a).localeCompare(requestedAt(b)));
    out.waitlistPosition = waiting.findIndex((p) => p.metadata.name === pod.metadata.name) + 1;
  }
  return out;
}

// Organizer view: per room, seats used/total in each pool and who is waiting for it.
async function roomStats() {
  const nodes = (await api('GET', '/api/v1/nodes?labelSelector=conf.io/room')).items;
  const pods = (await api('GET', `/api/v1/namespaces/${NS}/pods`)).items;
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
  }
  const list = Object.values(rooms).map((r) => ({ ...r, waitlist: waitingFor[r.talk] || 0 }));
  list.sort((a, b) => a.room.localeCompare(b.room));
  return { rooms: list, pending, attendees: pods.length };
}

module.exports = { ensureRooms, setSeats, swapTalks, requestSeat, cancelSeat, seatStatus, roomStats, attendeePod };
