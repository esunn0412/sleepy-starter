// kubeseat metrics (OpenTelemetry → Dash0).
//
// kubeseat.seat.time_to_seat  histogram (s): from the attendee's request until the
//                             scheduler seated them. Waitlisted people count too.
// kubeseat.seat.requests      counter: seat requests, by must_see / access_need.
// kubeseat.seat.releases      counter: "I can't make it".
// kubeseat.attendees.waiting  gauge: attendees not seated yet (Pending Pods).
// kubeseat.seats.used         gauge: seats taken, by room and pool.
// kubeseat.seats.capacity     gauge: seats, by room and pool.
//
// Attributes never carry personal data: rooms, pools and talk ids only.

const { metrics } = require('@opentelemetry/api');
const seats = require('./seats');

const meter = metrics.getMeter('kubeseat');

const timeToSeat = meter.createHistogram('kubeseat.seat.time_to_seat', {
  description: 'Time from seat request until the scheduler seated the attendee',
  unit: 's',
  advice: { explicitBucketBoundaries: [0.25, 0.5, 1, 2, 3, 5, 10, 30, 60, 300, 1800] },
});
const requests = meter.createCounter('kubeseat.seat.requests', { description: 'Seat requests' });
const releases = meter.createCounter('kubeseat.seat.releases', { description: 'Seats released by attendees' });

// Latest room stats, refreshed by the poller, read by the gauges.
let stats = null;

meter.createObservableGauge('kubeseat.attendees.waiting', { description: 'Attendees waiting for a seat' })
  .addCallback((r) => { if (stats) r.observe(stats.pending); });
meter.createObservableGauge('kubeseat.seats.used', { description: 'Seats taken' })
  .addCallback((r) => {
    for (const room of stats?.rooms || []) {
      r.observe(room.general.used, { 'kubeseat.room': room.room, 'kubeseat.pool': 'general', 'kubeseat.talk': room.talk });
      r.observe(room.accessible.used, { 'kubeseat.room': room.room, 'kubeseat.pool': 'accessible', 'kubeseat.talk': room.talk });
    }
  });
meter.createObservableGauge('kubeseat.seats.capacity', { description: 'Seats in the room' })
  .addCallback((r) => {
    for (const room of stats?.rooms || []) {
      r.observe(room.general.seats, { 'kubeseat.room': room.room, 'kubeseat.pool': 'general', 'kubeseat.talk': room.talk });
      r.observe(room.accessible.seats, { 'kubeseat.room': room.room, 'kubeseat.pool': 'accessible', 'kubeseat.talk': room.talk });
    }
  });

function recordRequest(prefs) {
  const n = prefs.needs || {};
  requests.add(1, {
    'kubeseat.must_see': !!prefs.mustSee,
    'kubeseat.access_need': !!(n.stepFree || n.captions || n.accessibleSeat),
  });
}

function recordRelease() {
  releases.add(1);
}

// Every second: record time-to-seat for newly seated attendees, exactly once across
// app replicas (the replica whose label write wins records it).
async function pollSeated() {
  try {
    for (const s of await seats.claimNewlySeated()) {
      timeToSeat.record(s.seconds, { 'kubeseat.room': s.room, 'kubeseat.pool': s.pool, 'kubeseat.must_see': s.mustSee });
    }
  } catch (e) {
    if (!e.upstream && !e.name?.includes('Timeout')) console.log(`metrics: ${e.message}`);
  }
  setTimeout(pollSeated, 1000);
}

async function pollStats() {
  try {
    stats = await seats.roomStats();
  } catch {
    // seat cluster restarting: keep the last values
  }
  setTimeout(pollStats, 5000);
}

function start() {
  pollSeated();
  pollStats();
}

module.exports = { start, recordRequest, recordRelease };
