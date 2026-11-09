// Server-rendered pages. Plain HTML, labelled controls and aria-live status
// updates so screen readers announce seat changes.

const style = `
:root{--bg:#fff;--fg:#1a1a1a;--muted:#5c5c5c;--line:#d9d9d9;--accent:#0b63ce;--ok:#1a7f37;--warn:#9a6700;--card:#f6f8fa}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9da7b3;--line:#30363d;--accent:#4c9aff;--ok:#3fb950;--warn:#d29922;--card:#161b22}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px}h1{margin:0 0 4px}p.sub{margin:0 0 24px;color:var(--muted)}
fieldset{border:1px solid var(--line);border-radius:8px;margin:0 0 16px;padding:12px 16px}legend{font-weight:600;padding:0 4px}
.talk{display:grid;grid-template-columns:1fr auto;gap:4px 12px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}
.talk:first-of-type{border-top:0}.meta{color:var(--muted);font-size:14px}
label{cursor:pointer}input[type=range]{width:140px}button{font:inherit;padding:8px 16px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
button.secondary{background:transparent;color:var(--accent)}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px;margin:16px 0}
.ok{color:var(--ok)}.warn{color:var(--warn)}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
.bar{height:8px;background:var(--line);border-radius:4px;overflow:hidden;margin-top:4px;min-width:80px}.bar>i{display:block;height:100%;background:var(--accent)}
.bar.full>i{background:var(--warn)}footer{margin-top:32px;color:var(--muted);font-size:13px}
h2{font-size:18px;margin:0 0 12px}h2 .meta{font-weight:400;font-size:14px;margin-left:6px}
.step{border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 16px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.chip{background:transparent;color:var(--fg);border:1px solid var(--line);border-radius:999px;padding:6px 14px}
.chip:hover{border-color:var(--accent)}.chip[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}
.quick{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media (max-width:600px){.quick{grid-template-columns:1fr}}
.src{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px}.src>label{font-weight:600}
.row{display:flex;gap:8px;margin:6px 0}.row input{flex:1;min-width:0;font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
.row input[type=file]{padding:4px;border-style:dashed}
.more{margin:12px 0 0}.more textarea{width:100%;font:inherit;margin-top:6px;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
.level{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:12px}.level input{position:absolute;opacity:0}
.level span:not(.meta){display:inline-block;padding:4px 12px;border:1px solid var(--line);border-radius:6px}
.level input:checked+span{border-color:var(--accent);color:var(--accent);font-weight:600}.level input:focus-visible+span{outline:2px solid var(--accent)}
#picks{display:flex;flex-direction:column;gap:8px}.pick{border:1px solid var(--line);border-radius:8px;padding:12px;transition:border-color .2s}
.pick.top{border-color:var(--accent)}.pick-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.pick-foot{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center;margin-top:6px}.pick-foot details{display:inline-block}
.badge{white-space:nowrap;font-size:13px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--card);border:1px solid var(--line)}
.pick.top .badge{background:var(--accent);border-color:var(--accent);color:#fff}.why mark{background:transparent;color:var(--accent);font-weight:600}
.none{order:99;padding:4px 12px}.access summary{cursor:pointer}.access[open] summary{margin-bottom:8px}
.go{position:sticky;bottom:0;padding:12px 0;background:var(--bg)}.go button{width:100%;padding:12px;font-weight:600}
`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', weekday: 'short', hour: 'numeric', minute: '2-digit' });

function layout(title, body, version) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${style}</style></head><body><main>${body}
<footer>kubeseat · the real kube-scheduler seats you · version ${esc(version)}</footer></main></body></html>`;
}

// Real KubeCon NA 2026 talk card: track, level, speakers, room, links to the
// session page and the speakers' slides.
function talkMeta(t, roomName) {
  const links = [
    t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">session</a>` : '',
    t.slidesUrl ? `<a href="${esc(t.slidesUrl)}" target="_blank" rel="noopener">slides</a>` : '',
  ].filter(Boolean).join(' · ');
  return `<div class="meta">${esc(t.track)} · ${esc(t.level === 'Any' ? 'Any level' : t.level)}${roomName ? ` · ${esc(roomName)}` : ''}</div>
    ${t.speakers?.length ? `<div class="meta">${esc(t.speakers.join(', '))}${links ? ` · ${links}` : ''}</div>` : ''}`;
}

const sourceNote = (note) => note ? `<p class="meta">${esc(note)} Source: <a href="https://kubecon-cloudnativecon-north-america-2026.sessionize.com" target="_blank" rel="noopener">KubeCon NA 2026 schedule</a>.</p>` : '';

// The attendee flow: one tap (topic chips), one field (GitHub), or one file (resume)
// is enough. Scoring runs automatically; sliders are tucked away for fine-tuning.
function attendeePage({ version, slot, talks, rooms = [], scoring, note }) {
  const roomOf = Object.fromEntries(rooms.map((r) => [r.talk, r.name]));
  // Chips: the projects these talks name, most-mentioned first, then the tracks.
  const count = {};
  talks.forEach((t) => t.projects.forEach((p) => { count[p] = (count[p] || 0) + 1; }));
  const chips = [...Object.keys(count).sort((a, b) => count[b] - count[a]), ...new Set(talks.map((t) => t.track))];
  const chipLabel = (c) => c.replace(/^[^A-Za-z0-9]+/, '');
  const cfg = { scoring, rooms: Object.fromEntries(rooms.map((r) => [r.id, r.name])),
    talks: talks.map(({ id, title, track, level, projects }) => ({ id, title, track, level, projects })) };
  const cards = talks.map((t) => `
    <article class="pick" data-talk="${esc(t.id)}">
      <div class="pick-head">
        <div><strong>${esc(t.title)}</strong>${talkMeta(t, roomOf[t.id])}</div>
        <span class="badge" hidden></span>
      </div>
      <div class="why meta" aria-live="polite"></div>
      <div class="pick-foot">
        <label><input type="radio" name="mustSee" value="${esc(t.id)}"> Must see</label>
        <details><summary class="meta">Adjust interest</summary>
          <input type="range" min="0" max="100" value="0" name="w-${esc(t.id)}" aria-label="Interest in ${esc(t.title)}">
        </details>
      </div>
    </article>`).join('');
  const body = `
<h1>kubeseat</h1><p class="sub">KubeCon + CloudNativeCon NA 2026 · ${esc(when(slot.startsAt))} · ${talks.length} talks at once.
  Tell us a little; the real Kubernetes scheduler finds you a seat.</p>
${sourceNote(note)}
<form id="f">
  <section class="step">
    <h2>1. What are you into? <span class="meta">Any one of these is enough</span></h2>
    <div class="chips" role="group" aria-label="Topics">${chips.map((c) => `<button type="button" class="chip" aria-pressed="false" data-topic="${esc(c)}">${esc(chipLabel(c))}</button>`).join('')}</div>
    <div class="quick">
      <div class="src"><label for="gh">GitHub</label>
        <div class="row"><input id="gh" name="github" placeholder="username" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="button" id="ghGo" class="secondary">Use</button></div>
        <div class="meta" id="ghMsg">We read your public repos and stars.</div></div>
      <div class="src"><label for="cv">Resume or LinkedIn PDF</label>
        <div class="row"><input id="cv" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain"></div>
        <div class="meta" id="cvMsg">Read in your browser. The file never leaves your device.</div></div>
    </div>
    <details class="more"><summary class="meta">Or describe it in your own words</summary>
      <textarea id="bio" name="bio" rows="2" maxlength="2000" placeholder="e.g. I run Node.js services and want to add tracing"></textarea></details>
    <div class="level" role="radiogroup" aria-label="Your level">
      <span class="meta">Your level</span>
      ${['Beginner', 'Intermediate', 'Advanced'].map((l) => `<label><input type="radio" name="level" value="${l}"${l === 'Intermediate' ? ' checked' : ''}><span>${l}</span></label>`).join('')}
    </div>
    <p class="meta" id="scoreMsg" aria-live="polite"></p>
  </section>
  <section class="step">
    <h2>2. Your picks</h2>
    <div id="picks">${cards}
      <label class="meta none"><input type="radio" name="mustSee" value="" checked> No must-see</label>
    </div>
  </section>
  <details class="step access"><summary><strong>Access needs</strong> <span class="meta">(always honored)</span></summary>
    <label><input type="checkbox" name="stepFree"> Step-free access</label><br>
    <label><input type="checkbox" name="captions"> Live captions</label><br>
    <label><input type="checkbox" name="accessibleSeat"> Accessible seating</label>
  </details>
  <div class="go"><button id="find">Find my seat</button></div>
</form>
<div id="seat" class="card" aria-live="polite" hidden></div>
<script id="cfg" type="application/json">${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>
<script src="/attendee.js"></script>`;
  return layout('kubeseat', body, version);
}

function organizerPage({ version, slot, talks, rooms = [], note }) {
  const roomNames = Object.fromEntries(rooms.map((r) => [r.id, r.name]));
  const titles = Object.fromEntries(talks.map((t) => [t.id, t.title]));
  const body = `
<h1>kubeseat · organizer</h1><p class="sub">KubeCon NA 2026 · ${esc(when(slot.startsAt))} · seats update live.</p>
${sourceNote(note)}
<p id="summary" aria-live="polite"></p>
<table><thead><tr><th>Room</th><th>Talk</th><th>General</th><th>Accessible</th><th>Waitlist</th><th>Seats</th></tr></thead><tbody id="rows"></tbody></table>
<div class="card"><form id="swap"><strong>Move a talk to another room</strong><br>
  <label>Room <select name="a" id="sa"></select></label> ⇄ <label>Room <select name="b" id="sb"></select></label>
  <button>Swap talks</button></form></div>
<script>
const titles = ${JSON.stringify(titles)};
const roomNames = ${JSON.stringify(roomNames)};
const bar = (p) => '<span>' + p.used + ' / ' + p.seats + '</span><div class="bar' + (p.used >= p.seats ? ' full' : '') +
  '"><i style="width:' + (p.seats ? Math.min(100, 100 * p.used / p.seats) : 0) + '%"></i></div>';
let filled = false;
async function load() {
  // Don't redraw while an organizer is typing a seat count.
  if (document.activeElement && document.activeElement.closest('#rows')) return setTimeout(load, 2000);
  const r = await fetch('/api/rooms');
  if (!r.ok) { document.getElementById('summary').textContent = 'Seat service unavailable.'; return setTimeout(load, 3000); }
  const d = await r.json();
  document.getElementById('summary').textContent = d.attendees + ' attendees, ' + d.pending + ' waiting for a seat.';
  document.getElementById('rows').innerHTML = d.rooms.map((x) =>
    '<tr><td>' + (roomNames[x.room] || x.room) + (x.stepFree ? ' <span title="step-free">♿</span>' : '') + (x.captions ? ' <span title="captions">CC</span>' : '') + '</td>' +
    '<td>' + (titles[x.talk] || x.talk) + '</td><td>' + bar(x.general) + '</td><td>' + bar(x.accessible) + '</td><td>' + x.waitlist + '</td>' +
    '<td><form data-room="' + x.room + '"><label class="meta">General <input type="number" min="0" max="5000" value="' + x.general.seats + '" style="width:5em"></label> <button class="secondary">Set</button></form></td></tr>').join('');
  document.querySelectorAll('#rows form').forEach((f) => f.onsubmit = async (e) => {
    e.preventDefault();
    await fetch('/api/rooms/' + f.dataset.room + '/seats', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pool: 'general', seats: Number(f.querySelector('input').value) }) });
    load();
  });
  if (!filled) {
    const opts = d.rooms.map((x) => '<option value="' + x.room + '">' + (roomNames[x.room] || x.room) + '</option>').join('');
    document.getElementById('sa').innerHTML = opts; document.getElementById('sb').innerHTML = opts; filled = true;
  }
  setTimeout(load, 2000);
}
document.getElementById('swap').onsubmit = async (e) => {
  e.preventDefault();
  const d = new FormData(e.target);
  await fetch('/api/swap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: d.get('a'), b: d.get('b') }) });
};
load();
</script>`;
  return layout('kubeseat organizer', body, version);
}

const attendeeScript = require('node:fs').readFileSync(require('node:path').join(__dirname, 'attendee.client.js'), 'utf8');

module.exports = { attendeePage, organizerPage, attendeeScript };
