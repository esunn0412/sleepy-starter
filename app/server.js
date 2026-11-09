// kubeseat: the real kube-scheduler seats conference attendees into talks.
// Rooms are Nodes and attendees are Pods in a private seat cluster (deploy/seats.yaml).
// Keep listening on $PORT and keep /healthz and /readyz.
const http = require('node:http');
const crypto = require('node:crypto');
const { trace } = require('@opentelemetry/api');
const seats = require('./seats');
const metrics = require('./metrics');
const { slot, talks, rooms } = require('./slot');
const { attendeePage, organizerPage } = require('./pages');
const elastic = require('./elastic');
const { githubProfileText } = require('./github');
const { toYaml } = require('./yaml');

const port = Number(process.env.PORT || 8080);
const version = process.env.APP_VERSION || 'dev';
// Organizer key from the app-credentials Secret. Unset = organizer controls disabled.
const organizerKey = process.env.ORGANIZER_TOKEN || '';
const talkIds = new Set(talks.map((t) => t.id));
const roomIds = new Set(rooms.map((r) => r.id));

// Create the rooms in the seat cluster; retry until it is up (it can start after us).
// Re-check every 30 s: the seat cluster keeps no state across restarts, and creating
// what already exists is a no-op (409), so edits like capacity changes survive.
let seeded = false;
async function seed() {
  try {
    await seats.ensureRooms(rooms);
    if (!seeded) console.log(`seat cluster seeded: ${rooms.length} rooms`);
    seeded = true;
    setTimeout(seed, 30000);
  } catch (e) {
    seeded = false;
    console.log(`seat cluster not ready, retrying: ${e.message}`);
    setTimeout(seed, 3000);
  }
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 16 * 1024) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); }
      catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); }
    });
  });
}

function sameSecret(given) {
  if (!organizerKey || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(organizerKey).digest();
  return crypto.timingSafeEqual(a, b);
}

function cookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

const isOrganizer = (req) => sameSecret(cookie(req, 'kubeseat_org') || req.headers['x-organizer-token']);

const loginPage = (msg) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>kubeseat organizer</title><body style="font:16px system-ui;max-width:420px;margin:48px auto;padding:0 16px">
<h1>Organizer sign-in</h1><p>${msg}</p><form method="post" action="/organizer/login">
<label>Organizer key <input type="password" name="key" autocomplete="current-password" required></label> <button>Sign in</button></form></body></html>`;

function readForm(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= 4096) chunks.push(c); });
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString())));
  });
}

// Accept only known talks and integer weights 1-100.
function parsePrefs(body) {
  const interests = (Array.isArray(body.interests) ? body.interests : [])
    .filter((i) => talkIds.has(i.talk))
    .map((i) => ({ talk: i.talk, weight: Math.min(100, Math.max(1, Math.round(Number(i.weight) || 1))) }));
  const mustSee = talkIds.has(body.mustSee) ? body.mustSee : null;
  const n = body.needs || {};
  const needs = { stepFree: !!n.stepFree, captions: !!n.captions, accessibleSeat: !!n.accessibleSeat };
  return { interests, mustSee, needs };
}

// Low-cardinality route names for spans (ids replaced by placeholders).
function routeName(p) {
  return p.replace(/^\/api\/attendees\/[0-9a-f]{10}(\/pod)?$/, '/api/attendees/:id$1')
    .replace(/^\/api\/rooms\/[a-z0-9-]+\/seats$/, '/api/rooms/:room/seats');
}

async function route(req, res, url) {
  const p = url.pathname;
  const span = trace.getActiveSpan();
  if (span) {
    const r = routeName(p);
    span.setAttribute('http.route', r);
    span.updateName(`${req.method} ${r}`);
    const id = p.match(/^\/api\/attendees\/([0-9a-f]{10})(?:\/pod)?$/);
    if (id) span.setAttribute('kubeseat.attendee.id', id[1]);
  }
  if (p === '/healthz' || p === '/readyz') return send(res, 200, 'ok\n', 'text/plain');
  if (p === '/' && req.method === 'GET') return send(res, 200, attendeePage({ version, slot, talks, scoring: elastic.enabled() }), 'text/html; charset=utf-8');
  if (p === '/organizer/login' && req.method === 'POST') {
    const key = (await readForm(req)).get('key') || '';
    if (!sameSecret(key)) return send(res, 401, loginPage(organizerKey ? 'Wrong key.' : 'Organizer controls are not configured.'), 'text/html; charset=utf-8');
    res.writeHead(303, {
      location: '/organizer',
      'set-cookie': `kubeseat_org=${encodeURIComponent(key)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`,
    });
    return res.end();
  }
  if (p === '/organizer' && req.method === 'GET') {
    if (!isOrganizer(req)) return send(res, 200, loginPage('Enter the organizer key to manage rooms.'), 'text/html; charset=utf-8');
    return send(res, 200, organizerPage({ version, slot, talks }), 'text/html; charset=utf-8');
  }
  // Everything below that changes rooms is organizer-only.
  const organizerWrite = req.method === 'POST' && (p === '/api/swap' || /^\/api\/rooms\//.test(p));
  if (organizerWrite && !isOrganizer(req)) return send(res, 401, { error: 'organizer sign-in required' });
  if (p === '/api/talks') return send(res, 200, { version, slot, talks, scoring: elastic.enabled() });

  // Score this person against the slot's talks with Elasticsearch. The profile text is
  // used for this query only: never stored, indexed or logged.
  if (p === '/api/score' && req.method === 'POST') {
    if (!elastic.enabled()) return send(res, 503, { error: 'scoring unavailable' });
    const body = await readJson(req);
    const level = ['Beginner', 'Intermediate', 'Advanced'].includes(body.level) ? body.level : 'Intermediate';
    const bio = String(body.bio || '').slice(0, 2000);
    const gh = body.github ? await githubProfileText(String(body.github)).catch(() => '') : '';
    const text = [bio, gh].filter(Boolean).join('. ');
    if (!text.trim()) return send(res, 400, { error: 'tell us a little about yourself, or a GitHub username' });
    span?.setAttribute('kubeseat.profile.github_used', !!gh);
    const scores = await elastic.scoreTalks(slot.id, text, level);
    return send(res, 200, { level, githubUsed: !!gh, scores });
  }

  if (p === '/api/attendees' && req.method === 'POST') {
    const prefs = parsePrefs(await readJson(req));
    const id = crypto.randomBytes(5).toString('hex');
    span?.setAttribute('kubeseat.attendee.id', id);
    await seats.requestSeat(id, prefs);
    metrics.recordRequest(prefs);
    return send(res, 201, { id });
  }
  // The Pod the scheduler actually got, as YAML (demo: "this is you, as a Pod").
  let m = p.match(/^\/api\/attendees\/([0-9a-f]{10})\/pod$/);
  if (m && req.method === 'GET') {
    const pod = await seats.getPod(m[1]);
    return pod ? send(res, 200, toYaml(pod), 'text/plain; charset=utf-8') : send(res, 404, { error: 'not found' });
  }
  m = p.match(/^\/api\/attendees\/([0-9a-f]{10})$/);
  if (m && req.method === 'GET') {
    const s = await seats.seatStatus(m[1]);
    return s ? send(res, 200, s) : send(res, 404, { error: 'not found' });
  }
  if (m && req.method === 'DELETE') {
    await seats.cancelSeat(m[1]);
    metrics.recordRelease();
    return send(res, 200, { released: true });
  }

  if (p === '/api/rooms' && req.method === 'GET') return send(res, 200, { seeded, ...(await seats.roomStats()) });
  m = p.match(/^\/api\/rooms\/([a-z0-9-]+)\/seats$/);
  if (m && req.method === 'POST' && roomIds.has(m[1])) {
    const body = await readJson(req);
    const pool = body.pool === 'accessible' ? 'accessible' : 'general';
    const n = Math.round(Number(body.seats));
    if (!(n >= 0 && n <= 5000)) return send(res, 400, { error: 'seats must be 0-5000' });
    await seats.setSeats(m[1], pool, n);
    return send(res, 200, { room: m[1], pool, seats: n });
  }
  if (p === '/api/swap' && req.method === 'POST') {
    const { a, b } = await readJson(req);
    if (!roomIds.has(a) || !roomIds.has(b) || a === b) return send(res, 400, { error: 'pick two different rooms' });
    const { reseated } = await seats.swapTalks(a, b);
    return send(res, 200, { swapped: [a, b], reseated });
  }
  return send(res, 404, 'not found\n', 'text/plain');
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return send(res, 400, 'bad request\n', 'text/plain');
  }
  try {
    await route(req, res, url);
  } catch (e) {
    const status = e.status && e.status < 500 && !e.upstream ? e.status : 502;
    console.log(`error ${req.method} ${url.pathname}: ${e.message}`);
    if (!res.headersSent) send(res, status, { error: status === 502 ? 'seat cluster unavailable' : e.message });
  }
});

server.listen(port, () => {
  console.log(`listening on :${port}, version ${version}`);
  seed();
  metrics.start();
});

// Exit cleanly when Kubernetes stops the pod, so rollouts don't drop requests.
// Flush the last telemetry batch first (telemetry.js is already loaded via --require;
// this returns the same module).
process.on('SIGTERM', () => server.close(async () => {
  await metrics.stop();
  await require('./telemetry').shutdown();
  process.exit(0);
}));
