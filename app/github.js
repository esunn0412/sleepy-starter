// Public GitHub signal for a profile: repo names, descriptions, topics, languages.
// Uses GITHUB_TOKEN from app-credentials if present (unauthenticated: 60 requests/hour
// per IP, shared by everyone at the venue). The username is never logged or stored.

const token = process.env.GITHUB_TOKEN || '';

async function githubProfileText(username) {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(username || '')) return '';
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'kubeseat' };
  if (token && !token.startsWith('$(')) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/users/${username}/repos?per_page=30&sort=pushed&type=owner`, {
    headers, signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return '';
  const repos = (await res.json()).filter((r) => !r.fork);
  const langs = [...new Set(repos.map((r) => r.language).filter(Boolean))];
  const lines = repos.map((r) => [r.name.replace(/[-_]/g, ' '), r.description, (r.topics || []).join(' ')].filter(Boolean).join(': '));
  return [lines.join('. '), langs.length ? `Languages: ${langs.join(', ')}` : ''].filter(Boolean).join('. ');
}

module.exports = { githubProfileText };
