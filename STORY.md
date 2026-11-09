# kubeseat on Radar: the story

## Before

Recorded 2026-11-09 13:07 MST (America/Denver), right after Argo CD took over the starter app (image `1ee2e69`).

Checks: https://app.radarhq.io/checks?scope=Ft5rnMvHlHw&namespace=team-sleepy

4 findings, all medium (0 critical, 0 high, 0 low):

- Security / `automountServiceAccountToken`: Deployment `team-sleepy/app`
- Security / `readOnlyRootFs`: Deployment `team-sleepy/app` (container `app`)
- Reliability / `missingPDB`: Deployment `team-sleepy/app` (2 replicas, no PodDisruptionBudget)
- Reliability / `missingTopologySpread`: Deployment `team-sleepy/app`
