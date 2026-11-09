// Public GitHub signal for a profile: what they build (own repos: names, descriptions,
// topics, languages) and what they're curious about (recently starred repos).
// Uses GITHUB_TOKEN from app-credentials if present (unauthenticated: 60 requests/hour
// per IP, shared by everyone at the venue). The username is never logged or stored.

const token = process.env.GITHUB_TOKEN || '';

async function githubProfileText(username) {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(username || '')) return '';
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'kubeseat' };
  if (token && !token.startsWith('$(')) headers.authorization = `Bearer ${token}`;
  const get = (path) => fetch(`https://api.github.com/users/${username}/${path}`, { headers, signal: AbortSignal.timeout(5000) })
    .then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const [own, starred] = await Promise.all([get('repos?per_page=30&sort=pushed&type=owner'), get('starred?per_page=20')]);
  const describe = (r) => [r.name.replace(/[-_]/g, ' '), r.description, (r.topics || []).join(' ')].filter(Boolean).join(': ');
  const repos = (Array.isArray(own) ? own : []).filter((r) => !r.fork);
  const stars = Array.isArray(starred) ? starred : [];
  const langs = [...new Set(repos.map((r) => r.language).filter(Boolean))];
  return [
    repos.map(describe).join('. '),
    langs.length ? `Languages: ${langs.join(', ')}` : '',
    stars.length ? `Interested in: ${stars.map(describe).join('. ')}` : '',
  ].filter(Boolean).join('. ');
}

module.exports = { githubProfileText };
