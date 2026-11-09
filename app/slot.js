// One real time slot of KubeCon + CloudNativeCon North America 2026 (Salt Lake City),
// imported from the public Sessionize schedule by scripts/import-kubecon.js:
// talks, descriptions, audience levels, tracks, rooms, speakers and slide links.
// Room seat counts and access features are estimates (not published).
// Times are UTC ISO strings (shown in America/Denver).

const data = require('./kubecon-slot.json');

// CNCF projects and core tech named in a talk: shown as "mentions …" and boosted in search.
const PROJECTS = ['Kubernetes', 'Argo CD', 'Argo', 'Backstage', 'Cilium', 'eBPF', 'Envoy', 'Istio', 'Linkerd',
  'OpenTelemetry', 'Prometheus', 'Jaeger', 'Grafana', 'Crossplane', 'Kueue', 'KEDA', 'Karpenter', 'Knative',
  'Kyverno', 'Falco', 'Sigstore', 'SPIFFE', 'OPA', 'Helm', 'Flux', 'containerd', 'CoreDNS', 'etcd', 'Gateway API',
  'vLLM', 'KServe', 'Kubeflow', 'Ray', 'Spark', 'Kafka', 'Dapr', 'wasmCloud', 'Rook', 'Vitess', 'TiKV', 'CloudNativePG',
  'Wazuh', 'GPU', 'DRA', 'MCP', 'LLM'];

function projectsIn(text) {
  return PROJECTS.filter((p) => new RegExp(`(^|[^A-Za-z])${p.replace(/ /g, '\\s+')}([^A-Za-z]|$)`, 'i').test(text));
}

const slot = data.slot;
const talks = data.talks.map((t) => ({ ...t, projects: projectsIn(`${t.title} ${t.abstract}`) }));
const rooms = data.rooms;

module.exports = { slot, talks, rooms, note: data.note };
