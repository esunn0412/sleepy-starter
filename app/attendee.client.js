// Attendee page script (served at /attendee.js).
// Profile input is any mix of topic chips, a GitHub username, a resume and free text.
// Nothing here is stored: the resume is read in the browser, scrubbed of contact details,
// and only its text is sent, once per scoring query.
(() => {
  const cfg = JSON.parse(document.getElementById('cfg').textContent);
  const $ = (id) => document.getElementById(id);
  const f = $('f'), out = $('seat'), msg = $('scoreMsg');
  const titles = Object.fromEntries(cfg.talks.map((t) => [t.id, t.title]));
  const profile = { topics: new Set(), github: '', githubText: '', resume: '' };

  // --- Inputs ----------------------------------------------------------------

  document.querySelectorAll('.chip').forEach((b) => {
    b.onclick = () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      if (on) profile.topics.add(b.dataset.topic); else profile.topics.delete(b.dataset.topic);
      schedule(250);
    };
  });

  const gh = $('gh'), ghMsg = $('ghMsg');
  // One lookup per username: skip one already in flight, ignore stale replies, and drop the
  // previous user's text when a new lookup fails.
  let ghPending = '', ghSeq = 0;
  async function useGithub() {
    const user = gh.value.trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//i, '').split('/')[0];
    if (!user) {
      ++ghSeq; ghPending = '';
      const had = !!profile.githubText;
      profile.github = profile.githubText = ''; ghMsg.textContent = 'We read your public repos and stars.';
      return had ? schedule(0) : undefined;
    }
    if (user === profile.github || user === ghPending) return;
    const n = ++ghSeq; ghPending = user;
    ghMsg.textContent = 'Reading @' + user + '…';
    const r = await fetch('/api/profile/github', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (n !== ghSeq) return;
    ghPending = '';
    if (!r || !r.ok) { profile.github = profile.githubText = ''; ghMsg.textContent = d.error || 'GitHub is unreachable right now.'; return schedule(0); }
    profile.github = user; profile.githubText = d.text;
    ghMsg.textContent = '✓ Using @' + user + "'s repos and stars.";
    schedule(0);
  }
  $('ghGo').onclick = useGithub;
  gh.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); useGithub(); } });
  gh.addEventListener('change', useGithub);

  const cv = $('cv'), cvMsg = $('cvMsg');
  cv.onchange = async () => {
    const file = cv.files[0];
    if (!file) return;
    cvMsg.textContent = 'Reading ' + file.name + '…';
    try {
      const raw = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name) ? await pdfText(file) : await file.text();
      profile.resume = scrub(raw).slice(0, 3000);
      cvMsg.textContent = profile.resume ? '✓ Read ' + file.name + '. Contact details removed.' : 'No text found in that file. Try a text-based PDF.';
      schedule(0);
    } catch {
      cvMsg.textContent = "Couldn't read that file. Try a PDF or .txt.";
    } finally {
      cv.value = ''; // drop our reference to the file
    }
  };

  $('bio').addEventListener('input', () => schedule(800));
  f.querySelectorAll('[name=level]').forEach((r) => r.addEventListener('change', () => schedule(0)));

  // Strip what a resume says about who you are, keep what you do.
  function scrub(t) {
    return t.replace(/\S+@\S+/g, ' ')
      .replace(/(https?:\/\/|www\.)\S+/gi, ' ')
      .replace(/\+?\d[\d\s().-]{7,}\d/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  // pdf.js is served by this app (/vendor/), not a CDN: no third-party code sees the resume.
  let pdfjs = null;
  function loadPdfjs() {
    if (pdfjs) return pdfjs;
    pdfjs = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/pdf.min.js';
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js'; resolve(window.pdfjsLib); };
      s.onerror = () => { pdfjs = null; reject(new Error('pdf.js failed to load')); };
      document.head.appendChild(s);
    });
    return pdfjs;
  }
  async function pdfText(file) {
    const lib = await loadPdfjs();
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, 5); i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      pages.push(c.items.map((x) => x.str).join(' '));
    }
    doc.destroy();
    return pages.join(' ');
  }

  // --- Scoring ---------------------------------------------------------------

  let timer = null, seq = 0;
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(score, ms); }

  const LEVEL_FIT = {
    Beginner: { Beginner: 1, Intermediate: 0.6, Advanced: 0.2, Any: 1 },
    Intermediate: { Beginner: 0.6, Intermediate: 1, Advanced: 0.6, Any: 1 },
    Advanced: { Beginner: 0.2, Intermediate: 0.6, Advanced: 1, Any: 1 },
  };

  // Used when Elasticsearch isn't configured or is unreachable: exact project and track names.
  function localScores(text, level) {
    const t = text.toLowerCase(), fit = LEVEL_FIT[level] || LEVEL_FIT.Intermediate;
    const scored = cfg.talks.map((talk) => {
      const hits = talk.projects.filter((p) => t.includes(p.toLowerCase()));
      const trackHit = t.includes(talk.track.toLowerCase());
      const benefit = Math.min(1, (hits.length * 2 + (trackHit ? 1 : 0)) / 4) * (fit[talk.level] ?? 1);
      const why = hits.length ? 'mentions ' + hits.join(', ') : trackHit ? talk.track + ' track' : 'Not much in common with your profile.';
      return { talk: talk.id, benefit, why };
    }).sort((a, b) => b.benefit - a.benefit);
    scored.forEach((s, i) => { s.weight = i < 3 && s.benefit > 0 ? Math.round(1 + 99 * s.benefit) : 0; });
    return scored;
  }

  // The server reads at most 16 KB of JSON. Non-Latin text is up to 3 bytes a character,
  // so trim the longest parts (resume, then GitHub) until the body fits.
  function scoreBody(b) {
    const size = (o) => new TextEncoder().encode(JSON.stringify(o)).length;
    while (size(b) > 15000) {
      if (b.resume.length > 500) b.resume = b.resume.slice(0, Math.floor(b.resume.length * 0.7));
      else if (b.githubText.length > 500) b.githubText = b.githubText.slice(0, Math.floor(b.githubText.length * 0.7));
      else { b.bio = b.bio.slice(0, Math.floor(b.bio.length * 0.7)); b.resume = b.githubText = ''; }
    }
    return JSON.stringify(b);
  }

  async function score() {
    const n = ++seq;
    const level = new FormData(f).get('level');
    const bio = $('bio').value.trim().slice(0, 2000);
    const topics = [...profile.topics];
    const used = [topics.length && topics.length + ' topic' + (topics.length > 1 ? 's' : ''), profile.githubText && 'GitHub', profile.resume && 'resume', bio && 'your words'].filter(Boolean);
    if (!used.length) { apply(null); msg.textContent = ''; return; }
    msg.textContent = 'Finding your talks…';
    let scores = null, how = 'by exact names';
    if (cfg.scoring) {
      const r = await fetch('/api/score', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: scoreBody({ topics, bio, githubText: profile.githubText, resume: profile.resume, level }) }).catch(() => null);
      if (r && r.ok) { scores = (await r.json()).scores; how = 'by Elasticsearch'; }
      else if (n === seq) how = 'by exact names (Elasticsearch was unavailable)';
    }
    if (n !== seq) return; // a newer change already started
    if (!scores) scores = localScores([topics.join(' '), bio, profile.githubText, profile.resume].join(' '), level);
    apply(scores);
    msg.textContent = 'Matched ' + how + ' from ' + used.join(' + ') + '. Your top picks become the scheduler’s preferences.';
  }

  function apply(scores) {
    const byTalk = Object.fromEntries((scores || []).map((s, i) => [s.talk, { ...s, rank: i }]));
    document.querySelectorAll('.pick').forEach((card) => {
      const s = byTalk[card.dataset.talk];
      const slider = card.querySelector('input[type=range]'), badge = card.querySelector('.badge');
      slider.value = s ? s.weight : 0;
      card.querySelector('.why').textContent = s ? s.why : '';
      card.style.order = s ? s.rank : '';
      card.classList.toggle('top', !!s && s.rank === 0 && s.weight > 0);
      badge.hidden = !s || !s.weight;
      badge.textContent = s && s.weight ? (s.rank === 0 ? 'Top pick' : 'Match ' + s.weight) : '';
    });
  }

  // --- Seat request ------------------------------------------------------------

  let id = null, pollTimer = null, podOpen = false;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = new FormData(f);
    const interests = Object.keys(titles).map((t) => ({ talk: t, weight: Number(d.get('w-' + t)) })).filter((i) => i.weight > 0);
    const body = { interests, mustSee: d.get('mustSee') || null,
      needs: { stepFree: d.has('stepFree'), captions: d.has('captions'), accessibleSeat: d.has('accessibleSeat') } };
    if (id) await fetch('/api/attendees/' + id, { method: 'DELETE' });
    const r = await fetch('/api/attendees', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    out.hidden = false;
    if (!r || !r.ok) { out.textContent = 'Could not reach the seat service. Try again in a moment.'; return; }
    id = (await r.json()).id;
    await poll();
    out.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  async function poll() {
    clearTimeout(pollTimer);
    const r = await fetch('/api/attendees/' + id);
    out.hidden = false;
    if (!r.ok) { out.textContent = 'No seat request.'; return; }
    const s = await r.json();
    const h = document.createElement('h2'), p = document.createElement('p');
    out.replaceChildren(h, p);
    if (s.state === 'seated') {
      h.className = 'ok'; h.textContent = 'Seated: ' + (cfg.rooms[s.room] || 'Room ' + s.room); p.textContent = titles[s.talk] || s.talk;
      if (s.accessibleSeat) out.append(Object.assign(document.createElement('p'), { textContent: 'Accessible seat held for you.' }));
    } else {
      h.className = 'warn'; h.textContent = 'Waiting'; p.textContent = s.reason;
      if (s.waitlistPosition) out.append(Object.assign(document.createElement('p'), { textContent: 'Waitlist position: #' + s.waitlistPosition }));
      pollTimer = setTimeout(poll, 2000);
    }
    const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary', textContent: s.state === 'seated' ? "I can't make it" : 'Leave the waitlist' });
    cancel.onclick = async () => {
      await fetch('/api/attendees/' + id, { method: 'DELETE' }); clearTimeout(pollTimer); id = null;
      out.textContent = 'Seat released. It goes to the next person on the waitlist.';
    };
    out.append(cancel);
    const podBox = document.createElement('details');
    podBox.innerHTML = '<summary>Show me as a Pod</summary><pre style="overflow:auto;font-size:13px"></pre>';
    const showPod = async () => { podBox.querySelector('pre').textContent = await (await fetch('/api/attendees/' + id + '/pod')).text(); };
    podBox.ontoggle = () => { podOpen = podBox.open; if (podOpen) showPod(); };
    out.append(podBox);
    if (podOpen) { podBox.open = true; showPod(); }
  }
})();
