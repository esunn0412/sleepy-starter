# Track tracker: what we have, why, and where to show it

The working source for the 3-minute video and the submission. For every track: the pitch line, the
judges' question, what's built with links to evidence, the demo moment, and what's left.
**Update the Evidence log when something lands** (PR merged, screenshot taken, number measured).

Status: ⬜ not started · 🟨 in progress · ✅ done and has evidence

## One-line pitch

Everyone teaches Kubernetes by pretending pods are people at tables. kubeseat makes it literal: the real,
unmodified kube-scheduler seats real KubeCon attendees into talks. Rooms are nodes, attendees are pods.

**Makes conferences easier because:** no more walking to a full room. You get a seat or a plain-English
reason ("Room full, you're #4 on the waitlist"), access needs are guaranteed, and organizers see demand live.

---

## Radar (app runs on the team cluster)

**Judges ask:** did you really use Radar (UI + MCP) to run and debug this, including one AI investigation on a real issue?

| Item | Status | Evidence |
| --- | --- | --- |
| App deployed via Argo CD, driven through Radar MCP (`apply_resource`, `manage_gitops`, `wait_for`) | ✅ | Application `app` Synced/Healthy at `fa207b8`; URL showed `version 1ee2e69` |
| Checks "before" recorded | ✅ | `STORY.md` (4 medium findings on `app`) |
| Seat cluster pod (KWOK apiserver + scheduler) running in the vcluster | 🟨 | PR #2 |
| Checks "after": fix the 4 findings (PDB, topology spread, read-only rootfs, SA token) | ⬜ | |
| One AI investigation on a real issue | ⬜ | |
| Prometheus / `top_resources` view of the seat pod under load | ⬜ | |

**Demo moment:** Radar topology of app → seats; Checks before/after; the investigation finding.

## Elastic (core data layer)

**Judges ask:** is Elasticsearch doing real work, or is it a key-value store?

| Item | Status | Evidence |
| --- | --- | --- |
| Talk index (title, abstract `semantic_text`, track, level, room, slot) for one slot | ⬜ | |
| Hybrid retrieval (kNN + BM25, linear retriever, min-max) scores person × talk | ⬜ | |
| Scores become preferred affinity weights (1 + 99 × benefit) | ⬜ | |
| Resume / LinkedIn PDF via attachment processor, file deleted after | ⬜ | (stretch) |

**Demo moment:** onboard live → "why this talk" shows the matched terms → those scores ARE the YAML weights.

## Dash0 (OpenTelemetry)

**Judges ask:** real telemetry, and did you find something with it?

| Item | Status | Evidence |
| --- | --- | --- |
| Endpoint + token available (`~/.kubeseat.env`, goes to Secret `app-credentials`, never git) | 🟨 | |
| Traces on every endpoint; metrics: time-to-seat, pending count, seat use | ⬜ | |
| SLO "95% seated within 5 s" + dashboard | ⬜ | |
| Agent0 / Dash0 MCP finding during the 1,000-attendee load test | ⬜ | |

**Demo moment:** load 1,000 → time-to-seat histogram and pending count draining after the room swap.

## Gitar (Sonar)

**Judges ask:** did Gitar shape the code, with custom rules for this domain?

| Item | Status | Evidence |
| --- | --- | --- |
| Custom rules in `.gitar/review/kubeseat.md` (seat model, privacy, secrets, budget) | 🟨 | PR #1 |
| Every feature lands through a Gitar-reviewed PR | 🟨 | PR #1, #2, #3, #4 |
| A Gitar comment that caught something real (and the fix) | ✅ | PR #2: seat apiserver is unauthenticated HTTP reachable cluster-wide → added NetworkPolicy (commit `51befc9`), Gitar re-reviewed: Approved |
| CI failure diagnosis / auto-apply used once | ⬜ | |

**Demo moment:** PR list + one comment where a kubeseat rule caught a violation.

## Merge Forward (inclusion)

**Judges ask:** is accessibility built in, not bolted on?

| Item | Status | Evidence |
| --- | --- | --- |
| Access needs (step-free, captions, low-sensory) as REQUIRED affinity | 🟨 | PR #4 (step-free, captions); tested locally |
| Protected accessible-seat pool (tainted node per room) | 🟨 | PR #4; tested: full room, pool untouched, holder still seated |
| Plain-English reasons instead of raw scheduler text | 🟨 | PR #4: "Room full: you are on the waitlist…", waitlist # |
| Accessible UI (labels, aria-live seat updates) | 🟨 | PR #4 |
| First-timer / beginner level fit | ⬜ | |

**Demo moment:** popular room fills, yet the accessible seats stay held for people who need them.

---

## Evidence log (newest first)

Time is America/Denver. One line each: what, where to see it.

- 13:24 · PR #4 opened: app seats attendees via the real scheduler; 9/9 end-to-end checks pass on a local kwokctl cluster · github.com/esunn0412/sleepy-starter/pull/4
- 13:22 · Gitar approved PR #2 after the fix
- 13:18 · **Gitar caught a real issue** on PR #2 (unauthenticated seat apiserver, no NetworkPolicy) → fixed in `51befc9`
- 13:15 · Screenshot: Radar Checks before (4 medium) taken
- 13:15 · PR #2 opened: seat cluster (KWOK in one pod) · github.com/esunn0412/sleepy-starter/pull/2
- 13:07 · Radar Checks "before" recorded: 4 medium findings · `STORY.md`
- 13:06 · Argo CD Application `app` created via Radar MCP; app live at `1ee2e69` · https://sleepy.cnh.radarhq.io
- 12:45 · PR #1 opened: project context, feasibility spike, Gitar rules · github.com/esunn0412/sleepy-starter/pull/1

## Screenshots to take

- [x] Radar Checks before (taken 13:15) · https://app.radarhq.io/checks?scope=Ft5rnMvHlHw&namespace=team-sleepy
- [ ] Radar topology with app + seats
- [ ] Radar AI investigation result
- [ ] Radar Checks after
- [ ] Dash0 dashboard + SLO
- [ ] Gitar PR comment: PR #2 NetworkPolicy finding + "Approved" after the fix
- [ ] Organizer view: room full + Pending reasons, then draining after the swap
