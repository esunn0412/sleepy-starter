// One demo time slot: talks and the rooms they are in. Placeholder data until the
// schedule is loaded into Elasticsearch. Times are UTC ISO strings (shown in America/Denver).

const slot = { id: 'tue-1415', startsAt: '2026-11-10T21:15:00Z' };

const talks = [
  { id: 'ebpf-net', title: 'eBPF networking without the magic', level: 'Intermediate', track: 'Networking' },
  { id: 'otel-101', title: 'OpenTelemetry for your first service', level: 'Beginner', track: 'Observability' },
  { id: 'sched-deep', title: 'Inside the kube-scheduler framework', level: 'Advanced', track: 'Scheduling' },
  { id: 'platform-eng', title: 'Platform engineering lessons from year one', level: 'Any', track: 'Platform' },
];

// seats includes accessibleSeats (the protected pool).
const rooms = [
  { id: '150', talk: 'ebpf-net', seats: 40, accessibleSeats: 4, stepFree: true, captions: true },
  { id: '151', talk: 'otel-101', seats: 25, accessibleSeats: 2, stepFree: false, captions: true },
  { id: '250', talk: 'sched-deep', seats: 15, accessibleSeats: 2, stepFree: true, captions: false },
  { id: 'hall-a', talk: 'platform-eng', seats: 120, accessibleSeats: 10, stepFree: true, captions: true },
];

module.exports = { slot, talks, rooms };
