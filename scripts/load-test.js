// Bounded load test: one conference slot, N attendees, then an organizer moves the
// packed talk to the big hall. Watch Dash0 (time-to-seat, waiting) and Radar while it runs.
//
//   ORGANIZER_TOKEN=... node scripts/load-test.js https://sleepy.cnh.radarhq.io [N=1000] [rate=20]
//
// Hard limits: at most 2,000 attendees, at most 50 requests/second.
// Phases:
//   1. Organizer sets realistic room sizes (general seats).
//   2. N attendees arrive at `rate`/s: 30% must-see the scheduler deep dive (small room 250),
//      ~5% need an accessible seat, ~3% need step-free access, the rest have weighted interests.
//   3. Report: seated, waiting, by room.
//   4. Organizer swaps the deep dive with hall-a. Report again: the waitlist drains.

const base = (process.argv[2] || '').replace(/\/$/, '');
const N = Number(process.argv[3] || 1000);
const rate = Number(process.argv[4] || 20);
const key = process.env.ORGANIZER_TOKEN || '';
if (!base.startsWith('http') || !key) {
  console.error('usage: ORGANIZER_TOKEN=... node scripts/load-test.js <url> [N] [rate]');
  process.exit(1);
}
// Reject anything outside the bounds instead of clamping: 0, negative or NaN would
// otherwise turn into an unthrottled burst.
if (!Number.isInteger(N) || N < 1 || N > 2000 || !Number.isFinite(rate) || rate <= 0 || rate > 50) {
  console.error('N must be an integer 1-2000 and rate a number >0 and <=50 (requests/s)');
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const org = { 'content-type': 'application/json', 'x-organizer-token': key };
async function call(method, path, body, headers = { "content-type": "application/json" }, timeoutMs = 15000) {
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// Deterministic pseudo-random, so runs are comparable.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const talks = ['ebpf-net', 'otel-101', 'sched-deep', 'platform-eng'];

function attendee(i) {
  const needs = {};
  if (rnd() < 0.05) needs.accessibleSeat = true;
  if (rnd() < 0.03) needs.stepFree = true;
  if (i % 10 < 3) {
    return { mustSee: 'sched-deep', needs, interests: [{ talk: 'sched-deep', weight: 100 }] };
  }
  const n = 1 + Math.floor(rnd() * 3);
  const chosen = [...new Set(Array.from({ length: n }, () => pick(talks)))];
  return { needs, interests: chosen.map((t) => ({ talk: t, weight: 1 + Math.floor(rnd() * 100) })) };
}

async function report(label) {
  const { body } = await call('GET', '/api/rooms');
  console.log(`\n${label}: ${body.attendees} attendees, ${body.pending} waiting`);
  for (const r of body.rooms) {
    console.log(`  room ${r.room.padEnd(7)} ${r.talk.padEnd(13)} general ${String(r.general.used).padStart(4)}/${String(r.general.seats).padEnd(5)} accessible ${r.accessible.used}/${r.accessible.seats}  waitlist ${r.waitlist}`);
  }
  return body;
}

async function settle(label) {
  // Wait until the waiting count stops changing (max ~30 s).
  let last = -1;
  for (let i = 0; i < 15; i++) {
    const { body } = await call('GET', '/api/rooms');
    if (body.pending === last) break;
    last = body.pending;
    await wait(2000);
  }
  return report(label);
}

(async () => {
  console.log(`Load test: ${N} attendees at ${rate}/s against ${base}`);
  for (const [room, seats] of [['150', 360], ['151', 230], ['250', 110], ['hall-a', 1400]]) {
    const r = await call('POST', `/api/rooms/${room}/seats`, { pool: 'general', seats }, org);
    if (r.status !== 200) throw new Error(`set seats ${room}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  await report('Rooms set');

  const t0 = Date.now();
  let ok = 0, failed = 0;
  const inflight = [];
  for (let i = 0; i < N; i++) {
    inflight.push(call('POST', '/api/attendees', attendee(i)).then((r) => (r.status === 201 ? ok++ : failed++), () => failed++));
    const due = t0 + ((i + 1) * 1000) / rate;
    if (due > Date.now()) await wait(due - Date.now());
    if ((i + 1) % 200 === 0) console.log(`  sent ${i + 1}/${N}`);
  }
  await Promise.all(inflight);
  console.log(`Sent ${N} in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${ok} accepted, ${failed} failed`);

  const before = await settle('After arrivals');

  console.log('\nOrganizer: move "Inside the kube-scheduler framework" (room 250) to hall-a');
  const t1 = Date.now();
  // The swap re-seats everyone in both rooms one by one (~40 ms each live): allow 2 min.
  const sw = await call('POST', '/api/swap', { a: '250', b: 'hall-a' }, org, 120000);
  console.log(`  swap: ${sw.status} ${JSON.stringify(sw.body)} in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  if (sw.status !== 200 || !(sw.body?.reseated > 0)) throw new Error(`FAIL: swap did not happen (${sw.status})`);
  const after = await settle('After the swap');
  // Nobody may lose their place: no attendee dropped, and nobody seated before the swap
  // pushed back to the waitlist (the seated count must not go down).
  const lost = before.attendees - after.attendees;
  const unseated = Math.max(0, (before.attendees - before.pending) - (after.attendees - after.pending));
  const kept = lost === 0 && unseated === 0;
  console.log(kept
    ? `\nPASS: all ${after.attendees} attendees kept their place; seated ${before.attendees - before.pending} -> ${after.attendees - after.pending}`
    : `\nFAIL: ${lost} attendees dropped, ${unseated} fewer seated after the swap`);
  if (!kept) process.exitCode = 1;
})().catch((e) => { console.error(e.message); process.exit(1); });
