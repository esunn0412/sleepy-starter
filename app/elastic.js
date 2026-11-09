// Elasticsearch: the talk index, and hybrid scoring of one person against a slot's talks.
// Those scores become the Pod's preferred node-affinity weights, so the scheduler's
// preferences ARE Elastic's relevance.
//
// Person data (bio, GitHub text) is only sent as a query: it is never indexed,
// stored or logged. The talk index holds talks only.

const INDEX = 'kubeseat-talks';
const url = (process.env.ELASTIC_URL || '').replace(/\/$/, '');
const apiKey = process.env.ELASTIC_API_KEY || '';
const enabled = () => url.startsWith('http') && apiKey && !apiKey.startsWith('$(');

async function es(method, path, body) {
  const res = await fetch(url + path, {
    method,
    headers: { authorization: `ApiKey ${apiKey}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`elastic ${method} ${path}: ${res.status} ${data?.error?.type || ''}`);
    err.upstream = true;
    throw err;
  }
  return data;
}

// --- Index -----------------------------------------------------------------

const mappings = {
  properties: {
    id: { type: 'keyword' },
    slot: { type: 'keyword' },
    title: { type: 'text' },
    abstract: { type: 'text' },
    // Meaning: ELSER sparse embeddings, managed by Elastic.
    content: { type: 'semantic_text', inference_id: '.elser-2-elastic' },
    projects: { type: 'text', fields: { raw: { type: 'keyword' } } },
    track: { type: 'keyword' },
    level: { type: 'keyword' },
    room: { type: 'keyword' },
  },
};

async function loadTalks(slot, talks, rooms) {
  const exists = await fetch(`${url}/${INDEX}`, { method: 'HEAD', headers: { authorization: `ApiKey ${apiKey}` } });
  if (exists.status === 404) await es('PUT', `/${INDEX}`, { mappings });
  for (const t of talks) {
    await es('PUT', `/${INDEX}/_doc/${t.id}?refresh=wait_for`, {
      id: t.id, slot: slot.id, title: t.title, abstract: t.abstract,
      content: `${t.title}. ${t.abstract}`,
      projects: t.projects, track: t.track, level: t.level,
      room: rooms.find((r) => r.talk === t.id)?.id,
    });
  }
}

// --- Scoring ---------------------------------------------------------------

// How well a talk's level suits the person (1 = perfect).
const LEVEL_FIT = {
  Beginner: { Beginner: 1.0, Intermediate: 0.6, Advanced: 0.2, Any: 1.0 },
  Intermediate: { Beginner: 0.6, Intermediate: 1.0, Advanced: 0.6, Any: 1.0 },
  Advanced: { Beginner: 0.2, Intermediate: 0.6, Advanced: 1.0, Any: 1.0 },
};

// Hybrid retrieval: ELSER semantic (meaning) + BM25 keyword (exact names like eBPF,
// Cilium, OpenTelemetry), each min-max normalized to 0..1, then combined 50/50 by
// Elastic's linear retriever. benefit = interest x level fit. The scheduler weight
// for the person's top 3 talks is 1 + 99 x benefit (integer 1-100).
async function scoreTalks(slotId, profileText, level = 'Intermediate') {
  const filter = [{ term: { slot: slotId } }];
  const text = profileText.slice(0, 4000);
  const res = await es('POST', `/${INDEX}/_search`, {
    size: 20,
    _source: ['id', 'title', 'level', 'projects'],
    retriever: {
      linear: {
        rank_window_size: 50,
        retrievers: [
          {
            retriever: { standard: { query: { bool: { filter, must: { semantic: { field: 'content', query: text } } } } } },
            weight: 0.5, normalizer: 'minmax',
          },
          {
            retriever: { standard: { query: { bool: { filter, must: { multi_match: { query: text, fields: ['title^2', 'abstract', 'projects^3'] } } } } } },
            weight: 0.5, normalizer: 'minmax',
          },
        ],
      },
    },
    highlight: {
      fields: {
        content: { type: 'semantic', number_of_fragments: 1 },
        abstract: { number_of_fragments: 1, fragment_size: 140 },
        projects: {},
      },
      pre_tags: ['<mark>'], post_tags: ['</mark>'],
    },
  });

  const fit = LEVEL_FIT[level] || LEVEL_FIT.Intermediate;
  const scored = res.hits.hits.map((h) => {
    const interest = Math.min(1, Math.max(0, h._score));
    const levelFit = fit[h._source.level] ?? 1;
    const benefit = interest * levelFit;
    const matched = (h.highlight?.projects || []).map(stripTags);
    return {
      talk: h._source.id,
      title: h._source.title,
      talkLevel: h._source.level,
      interest: round2(interest),
      levelFit,
      benefit: round2(benefit),
      matched,
      why: whyText(h, matched, levelFit, level),
    };
  });
  scored.sort((a, b) => b.benefit - a.benefit);
  // Only the top 3 become scheduler preferences.
  scored.forEach((s, i) => { s.weight = i < 3 && s.benefit > 0 ? Math.round(1 + 99 * s.benefit) : 0; });
  return scored;
}

const round2 = (n) => Math.round(n * 100) / 100;
const stripTags = (s) => s.replace(/<\/?mark>/g, '');

function whyText(hit, matched, levelFit, level) {
  if (hit._score < 0.15 && !matched.length) return 'Not much in common with your profile.';
  const parts = [];
  if (matched.length) parts.push(`mentions ${matched.join(', ')}`);
  const frag = hit.highlight?.abstract?.[0] || hit.highlight?.content?.[0];
  if (frag) parts.push(`"…${stripTags(frag).trim()}…"`);
  if (levelFit < 1) parts.push(`${hit._source.level} talk, you said ${level}`);
  return parts.join(' · ');
}

module.exports = { enabled, loadTalks, scoreTalks, INDEX };
