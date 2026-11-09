// Import one real time slot of KubeCon + CloudNativeCon North America 2026 from the
// public Sessionize schedule into app/kubecon-slot.json.
//
//   node scripts/import-kubecon.js [startsAt=2026-11-10T11:30:00]
//
// Kept from the schedule: session id, title, description, audience level, track,
// room, speakers' names, and the slide-deck link speakers attached. Room capacities
// and access features are NOT published, so they're marked as estimates.

const fs = require('node:fs');
const path = require('node:path');

const SCHEDULE = 'https://kubecon-cloudnativecon-north-america-2026.sessionize.com/api/schedule';
const startsAt = process.argv[2] || '2026-11-10T11:30:00';

// Estimated seats by room (not published). Grand Ballrooms are large, numbered rooms small.
function estimateSeats(name) {
  if (/Hall/i.test(name)) return 3000;
  if (/Grand Ballroom (ACE|BDF)/i.test(name)) return 900;
  if (/Grand Ballroom/i.test(name)) return 500;
  if (/Ballroom/i.test(name)) return 400;
  if (/\b2\d\d\b/.test(name)) return 250;
  return 120;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

(async () => {
  const res = await fetch(SCHEDULE, { headers: { 'user-agent': 'kubeseat-import' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`schedule: ${res.status}`);
  const d = await res.json();
  const cat = new Map();
  for (const c of d.categories) for (const i of c.items) cat.set(i.id, { group: c.title, name: i.name });
  const roomName = new Map(d.rooms.map((r) => [r.id, r.name]));
  const speaker = new Map(d.speakers.map((s) => [s.id, s.fullName]));
  const slidesQ = d.questions.find((q) => q.question === 'Presentation Slides')?.id;

  const talks = [];
  const rooms = [];
  for (const s of d.sessions) {
    if (s.startsAt !== startsAt || s.isServiceSession || s.isPlenumSession) continue;
    const cats = s.categoryItems.map((id) => cat.get(id)).filter(Boolean);
    const level = cats.find((c) => c.group === 'Audience Level')?.name;
    if (!level) continue; // not a breakout talk
    const full = roomName.get(s.roomId) || 'TBD';
    const parts = full.split('|').map((p) => p.trim());
    const room = {
      id: slug(parts.slice(-1)[0] + (parts[0].startsWith('Hyatt') ? '-hyatt' : '')),
      name: `${parts.slice(-1)[0]} (${parts[0]}, ${parts[1] || ''})`.replace(', )', ')'),
      venue: parts[0],
      talk: s.id,
      estimated: true,
    };
    room.seats = estimateSeats(full);
    room.accessibleSeats = Math.max(2, Math.round(room.seats * 0.02));
    room.stepFree = true; // ADA venues; estimate
    room.captions = /Grand Ballroom (ACE|BDF)/.test(full); // estimate: largest rooms only
    rooms.push(room);
    talks.push({
      id: s.id,
      title: s.title,
      abstract: (s.description || '').replace(/\r\n/g, '\n').trim(),
      level: level === 'Any Level' ? 'Any' : level,
      track: cats.find((c) => c.group === 'All Sessions')?.name || '',
      speakers: s.speakers.map((id) => speaker.get(id)).filter(Boolean),
      slidesUrl: s.questionAnswers.find((a) => a.questionId === slidesQ && a.answerValue)?.answerValue || null,
      url: `https://kubecon-cloudnativecon-north-america-2026.sessionize.com/session/${s.id}`,
    });
  }
  const out = {
    source: SCHEDULE,
    importedAt: new Date().toISOString(),
    note: 'Talks, levels, tracks, rooms, speakers and slides are from the public KubeCon NA 2026 schedule. Room seats and access features are estimates.',
    slot: { id: `kcna26-${startsAt.slice(5, 16).replace(/[-:T]/g, '')}`, startsAt: new Date(`${startsAt}-07:00`).toISOString() },
    talks,
    rooms,
  };
  const file = path.join(__dirname, '..', 'app', 'kubecon-slot.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${talks.length} talks, ${rooms.length} rooms (${talks.filter((t) => t.slidesUrl).length} with slides) to ${file}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
