# kubeseat: project context

Hackathon: WeMakeDevs Cloud Native Hackathon, Salt Lake City, Mon 2026-11-09 (America/Denver).
**Solo entry, team `sleepy`.** Build is underway. **Submission deadline 5:30 PM** on wemakedevs.org/hackathons/cnh
(mandatory; judged only on the submission; includes a 3-minute demo video). Live presentations are optional.
Theme: make conferences easier. Repo: `esunn0412/sleepy-starter` (public, from the Radar starter template; pushing to
`main` deploys). The pre-event feasibility spike is in `spike/` (originally branch `feasibility-spike` of the private
`esunn0412/kubeseat`). Use all 4 sponsor tools (Radar, Elastic, Gitar, Dash0): required for swag and Kelsey's books.

## The idea (one line)

Everyone teaches Kubernetes by pretending pods are people at tables. kubeseat makes it literal: the real, unmodified
kube-scheduler seats real KubeCon attendees into talks. Rooms are nodes, attendees are pods.

## Tracks we target (judges score depth of real use + "makes conferences easier")

- **Elasticsearch**: core data layer. Hybrid search scores each person against each talk; those scores ARE the scheduler's preferences.
- **Dash0**: OpenTelemetry traces/metrics/logs. Metrics: time-to-seat, pending count, seat use. SLO e.g. "95% seated within 5 s". Use Agent0 or Dash0 MCP to find something real. Dashboard/SLO is a bonus.
- **Radar**: app runs on the team cluster; use Radar UI + MCP all day; at least one AI investigation on a REAL issue. Radar judges ask teams NOT to break things on purpose.
- **Gitar (Sonar)**: every feature lands through a Gitar-reviewed PR; custom rules in `.gitar/review/`; CI failure diagnosis + auto-apply.
- **Merge Forward**: accessibility (step-free, captions, low-sensory) as hard constraints; protected accessible-seat pool; plain-English explanations for first-timers.

## Kubernetes model

| Conference | Kubernetes |
| --- | --- |
| Room | Node (KWOK fake node) advertising extended resource `conf.io/seat: <capacity>` |
| Attendee | Pod requesting 1 `conf.io/seat` (requests = limits), `schedulerName: default-scheduler` |
| Talk in a room | Node label `conf.io/talk=<talk-id>` |
| Interests | Preferred node affinity on `conf.io/talk`, weight 1-100 |
| Must-see talk | REQUIRED node affinity (stays Pending if full = waitlist) |
| Step-free etc. | REQUIRED node affinity on `access.conf.io/step-free=true` |
| Accessible-seat pool | Separate node per room with taint `conf.io/accessible-seats=true:NoSchedule`, label `conf.io/pool=accessible`; people who need it get the toleration AND a weight-100 preferred affinity to the pool |
| Friends | Preferred pod affinity, topologyKey `kubernetes.io/hostname` |
| Fairness tiers | PriorityClasses with `preemptionPolicy: Never` (priority orders the queue; nobody loses a seat) |
| Swap talk to bigger room | Relabel nodes; Pending pods get seated live |

Default scheduler score weights (v1.34): TaintToleration 3, NodeAffinity 2, InterPodAffinity 2, PodTopologySpread 2,
NodeResourcesFit 1, BalancedAllocation 1, ImageLocality 1. Each scorer normalizes to 0-100 across feasible nodes, so only
ratios between a person's weights matter. Friends (x2) can outweigh a mild interest (x2).

The scheduler only binds; nothing runs. KWOK marks pods Running without containers.

## Decisions made

- **Interest weights**: auto from Elastic, then the user can adjust (bump/lower/remove talks).
- **Must-see**: hard rule; stays Pending (waitlisted) if full.
- **"I can't make it"**: frees the seat to the waitlist + saves the talk to notify when the CNCF YouTube recording is posted. KubeCon does not appear to livestream breakouts.
- **Organizer controls**: change room capacity, reserve accessible seats per room, swap a talk to a bigger room. NO overflow-room button (no evidence KubeCon routinely opens overflow rooms; they have moved packed tracks to bigger rooms).
- **Fairness (agreed direction)**:
  - Talks unlikely to fill: seat instantly on request.
  - Popular talks (predicted to fill): hold seats until a cutoff (~30 min before slot), then seat in BENEFIT order, not lottery.
  - Missed-out boost: each time someone loses their first choice, they move up a PriorityClass tier (0-3) for later slots.
  - Rank at a popular talk = benefit + star bonus, within the missed-out tier. The app controls submission order; the scheduler seats by priority, then arrival.
- **Anti-gaming**: rank uses the Elastic auto-score, NOT user-edited weights. Users get 3 "really want" stars per day that add a fixed bonus.

## Scoring (person x talk)

- Talk index: title + abstract (`semantic_text`), track, CNCF projects mentioned, KubeCon "Content Experience Level"
  (Beginner confirmed on the schedule), room, slot, and slide text when speakers upload slides.
- Person profile: short bio / "what are you working on", GitHub (repo names, descriptions, topics, languages),
  resume or LinkedIn PDF text, level (inferred from GitHub/resume, user can correct), first-timer flag, access needs (filters, not scores).
- **interest** = Elastic linear retriever combining semantic (kNN) + keyword (BM25) with min-max normalization.
  Keyword catches exact names (eBPF, Cilium, OpenTelemetry); semantic catches meaning.
- **level fit** table: beginner -> Beginner 1.0, Intermediate ~0.6, Advanced 0.2; expert reversed; "Any" = 1.0.
- **benefit** = interest x level fit.
- **Scheduler weight** = 1 + 99 x benefit, for a person's top 3 talks in the slot (normalized within the slot).
- **Ranking at popular talks** uses raw (not slot-normalized) scores so people are comparable.

## Data sources

- **GitHub**: username + server-side token (unauthenticated limit is 60 req/hour per IP; a shared venue IP will hit it). OAuth optional.
- **LinkedIn**: "Sign in with LinkedIn" (OIDC) returns only name, email, photo, locale: use for login only. For content,
  "Import from LinkedIn" = guide user to Profile -> More -> Save to PDF (mobile browser works, not the app), then upload. Never scrape profiles.
  LinkedIn's Member Data Portability API is EEA-only and needs business verification: not usable.
- **Resume / LinkedIn PDF**: one upload path. Extract text with Elastic's attachment processor (Tika; set `remove_binary: true`,
  cap `indexed_chars`). Keep only the derived profile (interests, level, embedding), delete the file, keep person data out of
  the shared talk index, show the user "what we learned" with edit/delete.
- **Slides**: index slide PDF text via the attachment processor when available (many are uploaded after the talk).
- Scope for today: bio + GitHub username + resume/LinkedIn PDF; slides only for the demo slot. Sign-in flows are first to cut.

## Feasibility spike (done, folder `spike/` on `main`)

Ran the stock kube-scheduler v1.34.1 in-process against client-go's fake clientset; 16/16 checks pass:
interests become seat choices; seats are a hard cap; must-see + full room -> Pending with "Insufficient conf.io/seat";
adding capacity seats Pending people in ~100 ms; step-free enforced; accessible pool protected; friends sit together;
1,000 attendees into 12x100 seats in ~5.4 s (~185/s on 2 CPUs).

Design findings: steer access needs into the pool (else they take a general seat); scheduler is first-come-first-served,
so the app controls fairness via submission order; flag people whose needs no picked room meets (else seated anywhere);
translate raw Pending text into "Room full" / "No step-free room for this talk".

Since confirmed (2026-11-09): the seat cluster (`deploy/seats.yaml`, kwok/cluster image) runs inside the team
vcluster and the live app seats attendees through it. It runs no kube-controller-manager, so the app creates the
`default` ServiceAccount and clears the `node.kubernetes.io/not-ready` taint on room Nodes itself.

## Hackathon cluster facts (Radar starter: github.com/skyhook-io/cnh-starter)

- Each team gets a **vcluster** (cluster-admin inside it) via join.cnh.radarhq.io; app URL `https://<team>.cnh.radarhq.io`.
- Budget: 2 CPU / 4 GiB requests, 4 CPU / 8 GiB limits, 4 PVCs. No privileged pods, hostPath, hostNetwork.
- One public URL: Service `app` on port 80. Argo CD deploys on merge to main; images build to GHCR.
- **Biggest risk**: vcluster syncs pods to the host cluster and the host schedules them, so attendee pods must NOT be
  created in the vcluster itself. Plan: run a private seat cluster (kwokctl with its own apiserver + scheduler, binary runtime)
  inside ONE pod. Fallback: kwokctl on a laptop. Last resort: scheduler simulator.
- Elasticsearch likely in Elastic Cloud (trial) rather than in the 2 CPU budget; ask organizers it's OK for the Elastic track.

## Architecture

Attendee/Organizer -> kubeseat app (web UI + Pod translator, Service `app`:80) -> seat cluster pod (kwokctl API server +
kube-scheduler + KWOK; rooms = nodes, people = pods). App -> Elastic Cloud (scores talks). App -> Dash0 via OpenTelemetry.
GitHub + Gitar -> merge to main -> Argo CD deploys.

## Build plan (MT)

Solo, so scope tight. Deadline 5:30 PM.

1. Until ~2:00 riskiest first: seat cluster pod in the team cluster (fall back to laptop by 1:45); 3 room nodes + 1 test pod.
2. ~2:15 food arrives on the floor; Kelsey Hightower walks the floors: pitch in one sentence.
3. 2:00-4:00 core loop: load one slot of the KubeCon NA 2026 schedule into Elastic; onboarding; translator (Elastic -> Pod);
   "My day" card (Scheduled room or Pending + plain reason); organizer seat bars + capacity/swap controls; OTel to Dash0.
4. 4:00-4:45 load test 1,000+ attendees (real bottleneck in Dash0); one real Radar investigation; Dash0 dashboard + SLO.
5. 4:45-5:30 Radar story, record the 3-minute video, SUBMIT on wemakedevs before 5:30.
Cut line: if seating isn't end-to-end by 4:00, drop organizer view and stretch goals.

## Gitar review rules (commit as `.gitar/review/kubeseat.md`)

- Every attendee Pod requests exactly 1 `conf.io/seat`.
- Preferred affinity weights are integers 1-100 (scale Elastic scores).
- Access needs use REQUIRED affinity, never preferred.
- Accessible seats are a tainted pool; only Pods with the toleration use it.
- PriorityClasses use `preemptionPolicy: Never`.
- Times stored as UTC ISO strings; displayed in America/Denver.
- Never log names, emails, GitHub usernames or resume text; use attendee ids.
- No secrets in code/manifests/logs; read from the `app-credentials` Secret.
- Every container sets requests and limits; keep Service `app` on port 80 with /healthz and /readyz; no privileged/host access.
- New endpoints emit an OpenTelemetry span; seat changes update time-to-seat and pending-count metrics.

## Demo (3 min)

Hook (restaurant analogy made literal) -> onboard live, seated with "why", show the YAML -> load 1,000+ into one slot,
popular room fills, Pending with reason, accessible seats protected -> organizer swaps talk to a bigger room, Pending drains live
-> Dash0 time-to-seat + Agent0 finding, Radar investigation, Gitar PR count -> close: "bin-packing, constraints and explainable
decisions were already solved by the scheduler; we pointed it at people."

## Open questions

- Exact coding start; AI assistants allowed; Elastic Cloud OK for the Elastic track.
- ~~Can a pod in our vcluster run its own apiserver + scheduler (the KWOK spike)?~~ Yes: live since PR #2.
- Which sections LinkedIn's Save-to-PDF actually includes (test with a real profile).
