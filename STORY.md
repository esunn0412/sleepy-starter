# kubeseat on Radar: the story

## Before

Recorded 2026-11-09 13:07 MST (America/Denver), right after Argo CD took over the starter app (image `1ee2e69`).

Checks: https://app.radarhq.io/checks?scope=Ft5rnMvHlHw&namespace=team-sleepy

4 findings, all medium (0 critical, 0 high, 0 low):

- Security / `automountServiceAccountToken`: Deployment `team-sleepy/app`
- Security / `readOnlyRootFs`: Deployment `team-sleepy/app` (container `app`)
- Reliability / `missingPDB`: Deployment `team-sleepy/app` (2 replicas, no PodDisruptionBudget)
- Reliability / `missingTopologySpread`: Deployment `team-sleepy/app`

## After

Recorded ~15:26 MST. Same link. 3 findings, all medium, all on `seats` and kept by design:

- `seats` singleReplica: one control plane with in-memory state; two replicas would be two different clusters.
- `seats` runAsRoot / readOnlyRootFs: the upstream `kwok/cluster` image runs etcd + kube-apiserver as root and writes to its filesystem.
- `app`: 4 → 0 (PR #9: no SA token, read-only root FS, topology spread, PodDisruptionBudget).

## The story

- **What we built.** kubeseat lets the real, unmodified kube-scheduler place KubeCon attendees into talks: rooms are Nodes in a private Kubernetes control plane running in one pod of our vcluster, attendees are Pods. Elastic scores each person against the real KubeCon NA 2026 talks (descriptions + speakers' slides) and those scores become the Pod's affinity weights; a door clicker feeds live room occupancy back into the scheduler. Access needs are hard rules; accessible seats are a protected pool. (PRs #2, #4, #7, #15, #16, #17; https://sleepy.cnh.radarhq.io)
- **How we shipped.** 17 PRs, every one Gitar-reviewed (20+ real findings fixed), merged to `main`, built by the Action, synced by Argo CD and verified through Radar's MCP (`apply_resource`, `manage_gitops`, `wait_for`, `get_workload_logs`, `get_cluster_audit`).
- **What broke and how we found it.** (1) 13:37 the first live attendee was refused: the seat apiserver had no `default` ServiceAccount and new rooms kept a `not-ready` taint (no controller-manager in the seat pod); found in Radar logs, reproduced locally, fixed in #5. (2) 14:53 the 1,000-attendee load test silently lost 8 seats during a room swap (KWOK finished deletes by name and removed re-created Pods); fixed in #13, live re-run 1,000 → 1,000; swap 16 s → ~3 s (#14).
- **The investigation.** Radar's AI investigation on Deployment `app` (13:40) found the failing 403 and ruled out the rollout, but concluded RBAC. We checked the primary evidence: the 403 came from our private seat apiserver, not the vcluster, so we fixed it in git instead of granting RBAC we didn't need.
- **Dash0.** Agent0 found 99.7% of our spans came from our own background loop, not users; we suppressed tracing for background work and found metrics exporting every 60 s instead of 10 (#10). Load test: waitlist 225 → 0 after the room swap, time-to-seat and SLO on the dashboard.
- **Checks.** `app` 4 → 0; 3 left on `seats`, each with a reason (above).

---

## Demo script (≈2:55)

### Tabs to open, left to right

| Tab | Link |
| --- | --- |
| T1 Attendee | https://sleepy.cnh.radarhq.io |
| T2 Organizer (signed in; ideally also on your phone) | https://sleepy.cnh.radarhq.io/organizer |
| T3 Radar, `app` Deployment | https://app.radarhq.io/c/Ft5rnMvHlHw/resources/deployments?resource=team-sleepy/app |
| T4 Dash0 dashboard | https://app.dash0.com/dashboards?org=5f24023f-c249-46dd-8afa-69f2162f474e&s=eJxlUM1OwzAMfpecibama9f1hsSFExLjBZzZ7SylSZWkRajqu-MOmEDc8jnfn72onWoX1cUwqFb58K6LalAPKocvKE-EDImyYKQOJpdl1oXLlAjfeKBX8D2p1k_O3edPU4TMwf_5SzCMjn0vRoAwZp5JnNhn6oVN-NiTz_utDaeXkbxqc5xIqlwjAT7jpjNlXVVkNDWm1IfD8aAbA5UuysqiOYLZ1yfxvICf4dujA5do_Z9zZiQL8XfcjSp5H6N0luU9qVWUO4R0tQEipo3tOMktRLUVIqrBWlvroiml0LHotN2fGl1CWQDWWIMxUijc1xG_GSKDdbS5bZATCzpT5J8RIefboZZ1XT8BPIOJRw%3D%3D |
| T5 Dash0 SLO | https://app.dash0.com/alerting/slos/details?org=5f24023f-c249-46dd-8afa-69f2162f474e&s=eJxlUMtOwzAQ_BefsZI4rzY3BBdOSIC4om28TowcO7WdVBDl39mUgkC9WJ7dmdnZXVjCmoUp7wbWMOtOPCsHdsOi-4b0lRAhYCQsUcFkItWUa6eA8kUP-AS2Q9bYyZjf-v3kIWpn__UCDKPRtiMjkDBGPSM5aRuxIzbK2w5tTLc0OjyOaFkT_YQUpfcI8kFuOpFXZYmC407kvCjqgu8ElDzLy4MUNYi02pNnC3aGi4cCE3C9nvOsJR7A_x13ptK8j5Ey0_IW2UrKBAz6SMGTYFxIJEbQJmxCwkSk9y3NhjqrQB2V6j_D0O6Poi6q8j2k7MrhorxzVmk6xsKg3W7xqvF0XlJC6FM-E-Qbnf9cfV3XLwD6kLc%3D |
| T6 Gitar review on PR #13 (lost seats) | https://github.com/esunn0412/sleepy-starter/pull/13 |
| T7 Gitar custom rules | https://github.com/esunn0412/sleepy-starter/tree/main/.gitar/rules |
| T8 Radar AI investigation (the 13:40 one) | https://app.radarhq.io/c/Ft5rnMvHlHw/investigations |
| T9 Radar Checks (team-sleepy) | https://app.radarhq.io/checks?scope=Ft5rnMvHlHw&namespace=team-sleepy |

**Pre-flight (30 seconds):**

1. Open T1 and check the footer says **`version c68b64a`** (the door clicker build). Sign in on T2 with the organizer passphrase.
2. In Dash0 (T4, T5), set the time range to **15:05–15:15 MST** (the clean 1,000-attendee run).
3. To be sent to room **151** (the smallest, 118 seats, so the clicker fills it fast): tap the chips **Spark**, **Kueue** and **Data Processing + Storage**, and pick level **Beginner**. Top pick becomes *Why We Bet the Data Platform on Kubernetes*.
4. After filming, set room 151's door count back to 0 (−1 taps, or ask Claude).

### Script

| Time | Tab | Do | Say |
| --- | --- | --- | --- |
| **0:00–0:15** Hook | T1 | Header: *KubeCon NA 2026 · Tue 11:30 · 11 talks at once* | "At KubeCon, 11 talks run at once. You pick one, it's full, and you've missed the rest. Kubernetes solves this every second: the scheduler puts pods on nodes with room. kubeseat makes it literal: **rooms are nodes, attendees are pods**, and the real kube-scheduler decides." |
| **0:15–0:50** Elastic | T1 | Tap **Spark**, **Kueue**, **Data Processing + Storage**, level **Beginner**: talks re-rank live with a *Top pick* badge and reasons | "These are this conference's real talks: descriptions and **the speakers' slide decks**, extracted with Elastic's attachment processor. Hybrid search, ELSER for meaning plus BM25 for exact names, scores me and explains why: *mentions Kueue, Spark*, *in the slides…*. Those scores become my pod's affinity weights." |
| **0:50–1:05** Pod | T1 | **Find my seat** → expand **Show me as a Pod** | "Here I am as a Pod: Elastic's weights as preferred node affinity, requesting one seat. The scheduler sent me to room 151, with two backups." |
| **1:05–1:30** Live data + Merge Forward | T2 (phone) → T1 | Tap **+10** on room 151 until it reaches 118; switch back: *"just filled up at the door, head to your backup"* | "Nobody reserves seats at KubeCon, so a volunteer counts people at the door. That live count **is** the node's capacity: when it's full the scheduler stops sending people and redirects me. Access needs like step-free and captions are *required* rules; accessible seats are a protected pool." |
| **1:30–1:50** Radar | T3 | The `app` Deployment; point at `seats` | "It runs on our team cluster, deployed by Argo CD from git. The trick: a **private Kubernetes control plane inside one pod**, so a thousand attendee pods never touch the real cluster. Every deploy and debug went through Radar." |
| **1:50–2:20** Dash0 | T4 → T5 | Waiting count and time-to-seat from the load test, room fill; then the SLO | "We load-tested 1,000 attendees: the popular room fills, the organizer moves the talk to a bigger hall, the waitlist drains. Time-to-seat and our SLO, 95% within 5 s. Dash0's Agent0 found **99.7% of our traces were our own background loop**; we fixed it, and found metrics exporting every 60 s instead of 10." |
| **2:20–2:40** Gitar | T6 → T7 | Gitar's review on #13 and "Rules 4/4 met"; the rules folder | "Every change went through a Gitar-reviewed PR: 17 PRs, 24 real findings fixed. The load test caught **8 of 1,000 seats silently lost** in a room swap. Gitar enforces our custom kubeseat rules: one seat per pod, access needs as hard rules, no personal data in telemetry." |
| **2:40–2:55** Radar AI | T8 → T9 | The investigation; Checks (3 left, all on `seats`) | "Radar's AI investigation found our live failure in seconds. It guessed RBAC; the evidence showed the 403 came from our private API server, so we fixed it in git instead of granting permissions. Checks: `app` from 4 findings to 0." |
| **2:55–3:00** Close | T1 | | "Bin-packing, constraints and explainable decisions were already solved by the Kubernetes scheduler. **We just pointed it at people.**" |
