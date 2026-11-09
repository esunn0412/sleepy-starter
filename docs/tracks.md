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
| Seat cluster pod (KWOK apiserver + scheduler) running in the vcluster | ✅ | PR #2 merged; control plane started in 1.4 s (Radar `get_workload_logs`); Argo CD Synced at `dd48072` |
| App live and seeding rooms into the seat cluster | ✅ | PR #4 merged; image `26ba868`; logs "seat cluster seeded: 4 rooms" on both pods |
| Real issue found live: attendee Pods refused (no `default` ServiceAccount, no controller-manager in the seat pod) | ✅ | Fixed in PR #5 (`7d2af19`); reproduced locally with `kwokctl --disable-kube-controller-manager`; live attendee seated in Room 151 |
| One AI investigation on a real issue | ✅ | Radar investigation on Deployment `app` (13:40): correctly ruled out rollout/crash and pinned the failing 403 log line; concluded RBAC ("Likely"). We verified primary evidence: the 403 came from the private seat apiserver, not the vcluster, so its RBAC fix didn't apply. Fixed in git instead. **Screenshot it.** |
| All features live via GitOps, verified through Radar | ✅ | `d56972b`: seating + Elastic scoring + Dash0 telemetry; Argo CD Synced/Healthy; logs show telemetry on, rooms seeded |
| Checks "after": fix the 4 findings (PDB, topology spread, read-only rootfs, SA token) | ⬜ | |
| Prometheus / `top_resources` view of the seat pod under load | ⬜ | |

**Demo moment:** Radar topology of app → seats; Checks before/after; the investigation finding.

## Elastic (core data layer)

**Judges ask:** is Elasticsearch doing real work, or is it a key-value store?

| Item | Status | Evidence |
| --- | --- | --- |
| Talk index `kubeseat-talks` (title, abstract, CNCF projects, level, track, room; `content` = `semantic_text` on ELSER `.elser-2-elastic`), Serverless 9.7 | ✅ | PR #7; `scripts/load-talks.js` |
| Hybrid retrieval: `linear` retriever over ELSER semantic + BM25 `multi_match`, each `minmax`, 50/50; benefit = interest × level fit | ✅ | PR #7; beginner who wants tracing → OpenTelemetry 101 (100), eBPF 10, scheduler 7 (live) |
| Scores become preferred affinity weights (1 + 99 × benefit, top 3) | ✅ | Live Pod YAML shows weights 100/10/7 and `nodeName: room-151` |
| "Why this talk" from highlights (matched CNCF projects, abstract fragment, level) | ✅ | e.g. "mentions Cilium, eBPF"; "Intermediate talk, you said Beginner" |
| GitHub repos as profile signal (public repos, topics, languages; token from Secret) | ✅ | GitHub `cilium` → eBPF talk first (local test) |
| Person data never stored/indexed/logged; only sent as a query | ✅ | Gitar rule + code comments |
| Resume / LinkedIn PDF via attachment processor, file deleted after | ⬜ | (stretch) |

**Demo moment:** onboard live → "why this talk" shows the matched terms → those scores ARE the YAML weights.

## Dash0 (OpenTelemetry)

**Judges ask:** real telemetry, and did you find something with it?

| Item | Status | Evidence |
| --- | --- | --- |
| Endpoint + token in Secret `app-credentials` (never git) | ✅ | Created with kubectl from `~/.kubeseat.env` |
| Traces on every endpoint (route-named) + client spans for every seat-cluster API call | ✅ | PR #6, live at `d56972b` |
| Metrics: `kubeseat.seat.time_to_seat` histogram, requests/releases, waiting, seats used/capacity by room & pool; exactly-once across replicas | ✅ | PR #6; Gitar found 4 issues (lost samples, claiming while off, SLO spike, shutdown flush), all fixed |
| Live data visible in Dash0 (service `kubeseat`, env `hackathon`) | ⬜ | check in Dash0 UI |
| SLO "95% seated within 5 s" + dashboard | ⬜ | |
| Agent0 / Dash0 MCP finding during the 1,000-attendee load test | ⬜ | |

**Demo moment:** load 1,000 → time-to-seat histogram and pending count draining after the room swap.

## Gitar (Sonar)

**Judges ask:** did Gitar shape the code, with custom rules for this domain?

| Item | Status | Evidence |
| --- | --- | --- |
| Custom rules in `.gitar/rules/` (seat-model, privacy, secrets, manifests, telemetry) | 🟨 | Were in `.gitar/review/` with no frontmatter, so Gitar reported "No rules evaluated" on every PR; moved to `.gitar/rules/*.md` with frontmatter (PR #12). Gitar had refined the resource rule on #1 |
| Every feature lands through a Gitar-reviewed PR | ✅ | PR #1–#7, all Gitar-approved before merge |
| **11 real findings, all fixed** | ✅ | #1: 2 · #2: 1 (unauthenticated seat apiserver → NetworkPolicy) · #4: 2 (swap broke seating/step-free; organizer endpoints open) · #6: 4 (telemetry sample loss, SLO spike, shutdown flush) · #7: 2 (attendee ids in span names; GitHub token not wired) |
| Gitar caught 2 more real issues on PR #4 | ✅ | swap left seated people in the wrong talk (and could break step-free needs); organizer endpoints had no auth → fixed in `d09bf00`, Gitar: Approved, 2 closed / 2 findings |
| A Gitar comment that caught something real (and the fix) | ✅ | PR #2: seat apiserver is unauthenticated HTTP reachable cluster-wide → added NetworkPolicy (commit `51befc9`), Gitar re-reviewed: Approved |
| CI failure diagnosis / auto-apply used once | ⬜ | |

**Demo moment:** PR list + one comment where a kubeseat rule caught a violation.

## Merge Forward (inclusion)

**Judges ask:** is accessibility built in, not bolted on?

| Item | Status | Evidence |
| --- | --- | --- |
| Access needs (step-free, captions) as REQUIRED affinity | ✅ | PR #4, live; unmet need → "No room for this talk meets your access needs yet" |
| Protected accessible-seat pool (tainted node per room) | ✅ | live; tested: full room, pool untouched, holder still seated |
| Room swap keeps access guarantees (everyone re-seated against new labels) | ✅ | Gitar caught it on #4; fixed + tested |
| Plain-English reasons instead of raw scheduler text | ✅ | "Room full: you are on the waitlist…", waitlist # |
| Accessible UI (labels, aria-live seat updates) | ✅ | PR #4 |
| First-timer / beginner level fit | ✅ | PR #7: level-fit table (Beginner talk 1.0 for beginners, Advanced 0.2) |
| Low-sensory rooms | ⬜ | (not built; mention as next) |

**Demo moment:** popular room fills, yet the accessible seats stay held for people who need them.

---

## Evidence log (newest first)

Time is America/Denver. One line each: what, where to see it.

- 14:19 · **All features live** at `d56972b` (PRs #6, #7 merged): live score → seat → Pod YAML with weights 100/10/7 in Room 151
- 14:15 · Gitar: #7 approved 2/2 closed (span-name cardinality, GitHub token wiring)
- 14:05 · Elastic: talk index loaded; hybrid scoring verified on 3 profiles
- 14:00 · Gitar: #6 approved 4/4 closed
- 13:55 · PR #5 live (`7d2af19`): first live attendee seated in Room 151
- 13:40 · **Radar AI investigation** on `app`: found the 403, concluded RBAC; we verified it was the seat apiserver, not RBAC

- 13:45 · PR #5: fix reproduced locally with `kwokctl --disable-kube-controller-manager` (before: every seat waiting; after: 16/16)
- 13:37 · **Real live issue**: first attendee on https://sleepy.cnh.radarhq.io refused — seat cluster has no `default` ServiceAccount (and new Nodes keep a `not-ready` taint) because no controller-manager runs in the seat pod
- 13:36 · PR #4 live: `26ba868`, 4 rooms seeded, organizer swap without key → 401
- 13:30 · Gitar approved PR #4 after fixing its 2 findings (swap re-seating, organizer auth)
- 13:27 · PR #2 merged; seat control plane up in the vcluster in 1.4 s — biggest risk retired
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
