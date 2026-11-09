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
`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', weekday: 'short', hour: 'numeric', minute: '2-digit' });

function layout(title, body, version) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${style}</style></head><body><main>${body}
<footer>kubeseat · the real kube-scheduler seats you · version ${esc(version)}</footer></main></body></html>`;
}

function attendeePage({ version, slot, talks, scoring }) {
  const about = scoring ? `
  <fieldset><legend>1. About you</legend>
    <p class="meta">Elasticsearch matches you to talks by meaning and by exact names (eBPF, Cilium, OpenTelemetry…).
      We use this once to score talks; we don't store it.</p>
    <label for="bio">What are you working on, or want to learn?</label>
    <textarea id="bio" name="bio" rows="3" style="width:100%;font:inherit" placeholder="e.g. I run Node.js services and want to add tracing"></textarea>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px">
      <label>GitHub username (optional) <input name="github" autocomplete="off" style="width:12em"></label>
      <label>Your level <select name="level"><option>Beginner</option><option selected>Intermediate</option><option>Advanced</option></select></label>
    </div>
    <p><button type="button" id="score" class="secondary">Score my talks</button> <span id="scoreMsg" class="meta" aria-live="polite"></span></p>
  </fieldset>` : '';
  const rows = talks.map((t) => `
    <div class="talk">
      <div><strong>${esc(t.title)}</strong><div class="meta">${esc(t.track)} · ${esc(t.level)}</div>
        <div class="why meta" id="why-${esc(t.id)}" aria-live="polite"></div></div>
      <div>
        <label>Interest <input type="range" min="0" max="100" value="0" name="w-${esc(t.id)}" aria-label="Interest in ${esc(t.title)}"></label>
        <label><input type="radio" name="mustSee" value="${esc(t.id)}"> Must see</label>
      </div>
    </div>`).join('');
  const body = `
<h1>kubeseat</h1><p class="sub">Pick what you want to see at ${esc(when(slot.startsAt))}. The Kubernetes scheduler finds you a seat.</p>
<form id="f">${about}
  <fieldset><legend>${scoring ? '2. ' : ''}Talks this slot</legend>${rows}
    <div class="talk"><div class="meta">No must-see</div><div><label><input type="radio" name="mustSee" value="" checked> None</label></div></div>
  </fieldset>
  <fieldset><legend>Access needs (always honored)</legend>
    <label><input type="checkbox" name="stepFree"> Step-free access</label><br>
    <label><input type="checkbox" name="captions"> Live captions</label><br>
    <label><input type="checkbox" name="accessibleSeat"> Accessible seating</label>
  </fieldset>
  <button>Find my seat</button>
</form>
<div id="seat" class="card" aria-live="polite" hidden></div>
<script>
const talks = ${JSON.stringify(Object.fromEntries(talks.map((t) => [t.id, t.title])))};
const f = document.getElementById('f'), out = document.getElementById('seat');
let id = null, timer = null, podOpen = false;
const scoreBtn = document.getElementById('score');
if (scoreBtn) scoreBtn.onclick = async () => {
  const d = new FormData(f), msg = document.getElementById('scoreMsg');
  msg.textContent = 'Scoring…';
  const r = await fetch('/api/score', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bio: d.get('bio'), github: d.get('github'), level: d.get('level') }) });
  const s = await r.json().catch(() => ({}));
  if (!r.ok) { msg.textContent = s.error || 'Scoring is unavailable; set your interests by hand.'; return; }
  for (const x of s.scores) {
    const slider = f.querySelector('[name="w-' + x.talk + '"]');
    if (slider) slider.value = x.weight;
    const why = document.getElementById('why-' + x.talk);
    if (why) why.textContent = (x.weight ? 'Weight ' + x.weight + ': ' : 'Not in your top 3: ') + x.why;
  }
  msg.textContent = 'Done. These weights go into your Pod. Adjust them if you like.' + (s.githubUsed ? ' (GitHub repos included.)' : '');
};
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = new FormData(f);
  const interests = Object.keys(talks).map((t) => ({ talk: t, weight: Number(d.get('w-' + t)) })).filter((i) => i.weight > 0);
  const body = { interests, mustSee: d.get('mustSee') || null,
    needs: { stepFree: d.has('stepFree'), captions: d.has('captions'), accessibleSeat: d.has('accessibleSeat') } };
  if (id) await fetch('/api/attendees/' + id, { method: 'DELETE' });
  const r = await fetch('/api/attendees', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { out.hidden = false; out.textContent = 'Could not reach the seat service. Try again in a moment.'; return; }
  id = (await r.json()).id; poll();
});
async function poll() {
  clearTimeout(timer);
  const r = await fetch('/api/attendees/' + id);
  out.hidden = false;
  if (!r.ok) { out.textContent = 'No seat request.'; return; }
  const s = await r.json();
  if (s.state === 'seated') {
    out.innerHTML = '<h2 class="ok">Seated: Room ' + s.room + '</h2><p>' + (talks[s.talk] || s.talk) + '</p>' +
      (s.accessibleSeat ? '<p>Accessible seat held for you.</p>' : '') + '<button class="secondary" id="cancel">I can\\'t make it</button>';
  } else {
    out.innerHTML = '<h2 class="warn">Waiting</h2><p>' + s.reason + '</p>' +
      (s.waitlistPosition ? '<p>Waitlist position: #' + s.waitlistPosition + '</p>' : '') + '<button class="secondary" id="cancel">Leave the waitlist</button>';
    timer = setTimeout(poll, 2000);
  }
  const podBox = document.createElement('details');
  podBox.innerHTML = '<summary>Show me as a Pod</summary><pre style="overflow:auto;font-size:13px"></pre>';
  const showPod = async () => { podBox.querySelector('pre').textContent = await (await fetch('/api/attendees/' + id + '/pod')).text(); };
  podBox.ontoggle = () => { podOpen = podBox.open; if (podOpen) showPod(); };
  out.appendChild(podBox);
  if (podOpen) { podBox.open = true; showPod(); }
  document.getElementById('cancel').onclick = async () => {
    await fetch('/api/attendees/' + id, { method: 'DELETE' }); clearTimeout(timer); id = null;
    out.textContent = 'Seat released. It goes to the next person on the waitlist.';
  };
}
</script>`;
  return layout('kubeseat', body, version);
}

function organizerPage({ version, slot, talks }) {
  const titles = Object.fromEntries(talks.map((t) => [t.id, t.title]));
  const body = `
<h1>kubeseat · organizer</h1><p class="sub">Rooms for ${esc(when(slot.startsAt))}. Seats update live.</p>
<p id="summary" aria-live="polite"></p>
<table><thead><tr><th>Room</th><th>Talk</th><th>General</th><th>Accessible</th><th>Waitlist</th><th>Seats</th></tr></thead><tbody id="rows"></tbody></table>
<div class="card"><form id="swap"><strong>Move a talk to another room</strong><br>
  <label>Room <select name="a" id="sa"></select></label> ⇄ <label>Room <select name="b" id="sb"></select></label>
  <button>Swap talks</button></form></div>
<script>
const titles = ${JSON.stringify(titles)};
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
    '<tr><td>' + x.room + (x.stepFree ? ' <span title="step-free">♿</span>' : '') + (x.captions ? ' <span title="captions">CC</span>' : '') + '</td>' +
    '<td>' + (titles[x.talk] || x.talk) + '</td><td>' + bar(x.general) + '</td><td>' + bar(x.accessible) + '</td><td>' + x.waitlist + '</td>' +
    '<td><form data-room="' + x.room + '"><label class="meta">General <input type="number" min="0" max="5000" value="' + x.general.seats + '" style="width:5em"></label> <button class="secondary">Set</button></form></td></tr>').join('');
  document.querySelectorAll('#rows form').forEach((f) => f.onsubmit = async (e) => {
    e.preventDefault();
    await fetch('/api/rooms/' + f.dataset.room + '/seats', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pool: 'general', seats: Number(f.querySelector('input').value) }) });
    load();
  });
  if (!filled) {
    const opts = d.rooms.map((x) => '<option>' + x.room + '</option>').join('');
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

module.exports = { attendeePage, organizerPage };
