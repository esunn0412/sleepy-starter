# kubeseat review rules

kubeseat seats conference attendees with the real kube-scheduler: rooms are Nodes, attendees are Pods.
Flag any change that breaks these rules.

## Seat model
- Every attendee Pod requests exactly 1 `conf.io/seat`, with requests equal to limits.
- Preferred affinity weights are integers from 1 to 100. Scale Elastic scores into that range; never pass raw floats.
- Access needs (step-free, captions, low-sensory) use REQUIRED node affinity, never preferred.
- Accessible seats are a tainted node pool (`conf.io/accessible-seats=true:NoSchedule`). Only Pods that need it carry the toleration.
- PriorityClasses use `preemptionPolicy: Never`, so nobody loses a seat they already have.
- Ranking at popular talks uses the Elastic auto-score, not user-edited weights.

## Data and privacy
- Times are stored as UTC ISO 8601 strings and displayed in America/Denver.
- Never log names, emails, GitHub usernames or resume text. Log attendee ids only.
- Uploaded resume or LinkedIn PDF files are deleted after the profile is derived. Person data stays out of the shared talk index.

## Secrets
- No secrets, tokens or kubeconfigs in code, manifests, Dockerfiles, build args or logs. This repo and its image are public.
- Credentials come from the `app-credentials` Kubernetes Secret, through environment variables.

## Kubernetes manifests
- Every container in app manifests deployed to the team cluster (`deploy/`) sets CPU and memory requests and limits. The cluster budget is 2 CPU / 4 GiB of requests in total. Attendee Pods in the KWOK seat cluster are exempt: they request only `conf.io/seat`, so the scheduler weighs seats and nothing else.
- Keep Service `app` on port 80, and keep the `/healthz` and `/readyz` endpoints.
- No privileged containers, hostPath, hostNetwork or hostPID.
- Don't apply or patch app manifests on the cluster directly; Argo CD deploys from `main`.

## Observability
- New HTTP endpoints emit an OpenTelemetry span.
- Seat changes update the time-to-seat and pending-count metrics.
