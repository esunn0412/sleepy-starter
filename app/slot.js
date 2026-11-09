// One demo time slot: talks and the rooms they are in. Sample talks written for the
// demo (not the real KubeCon schedule). scripts/load-talks.js indexes them into
// Elasticsearch, which scores each attendee against them.
// Times are UTC ISO strings (shown in America/Denver).

const slot = { id: 'tue-1415', startsAt: '2026-11-10T21:15:00Z' };

const talks = [
  {
    id: 'ebpf-net', title: 'eBPF networking without the magic', level: 'Intermediate', track: 'Networking',
    projects: ['Cilium', 'eBPF', 'Hubble'],
    abstract: 'Packets, maps and programs: we trace one request through a Cilium-powered cluster to show what eBPF '
      + 'actually does in the kernel, replacing kube-proxy and iptables. Live demos with Hubble flow logs, network '
      + 'policy enforcement, and debugging dropped packets with bpftool. You should know how a Kubernetes Service works.',
  },
  {
    id: 'otel-101', title: 'OpenTelemetry for your first service', level: 'Beginner', track: 'Observability',
    projects: ['OpenTelemetry', 'Prometheus', 'Jaeger'],
    abstract: 'Never instrumented an app? Start here. We add OpenTelemetry tracing, metrics and logs to a small web '
      + 'service step by step, send them through the Collector, and read the first trace together. Covers spans, '
      + 'context propagation, semantic conventions and SLOs. No prior observability experience needed.',
  },
  {
    id: 'sched-deep', title: 'Inside the kube-scheduler framework', level: 'Advanced', track: 'Scheduling',
    projects: ['Kubernetes', 'Kueue'],
    abstract: 'Filter, Score, Reserve, Permit, Bind: a deep dive into the scheduling framework and how to write your own '
      + 'plugin. We cover node affinity, taints and tolerations, inter-pod affinity, topology spread, preemption and '
      + 'priority, and batch scheduling with Kueue, with benchmarks from clusters running thousands of nodes.',
  },
  {
    id: 'platform-eng', title: 'Platform engineering lessons from year one', level: 'Any', track: 'Platform',
    projects: ['Backstage', 'Argo CD', 'Crossplane'],
    abstract: 'What we got wrong building an internal developer platform: golden paths in Backstage, GitOps with Argo CD, '
      + 'and self-service infrastructure with Crossplane. Team topologies, measuring developer experience, and why '
      + 'the platform is a product. Useful whether you build platforms or use one.',
  },
];

// seats includes accessibleSeats (the protected pool).
const rooms = [
  { id: '150', talk: 'ebpf-net', seats: 40, accessibleSeats: 4, stepFree: true, captions: true },
  { id: '151', talk: 'otel-101', seats: 25, accessibleSeats: 2, stepFree: false, captions: true },
  { id: '250', talk: 'sched-deep', seats: 15, accessibleSeats: 2, stepFree: true, captions: false },
  { id: 'hall-a', talk: 'platform-eng', seats: 120, accessibleSeats: 10, stepFree: true, captions: true },
];

module.exports = { slot, talks, rooms };
