---
title: "kubeseat: team cluster manifests"
description: "Manifests in deploy/ must fit the hackathon cluster's budget and limits"
type: check
when: "PRs that change files under deploy/ or argocd/"
actions: "Comment on each violation and request changes"
---

# Team cluster manifests

- Every container in `deploy/` sets CPU and memory requests and limits. The whole cluster budget is 2 CPU / 4 GiB of requests and 4 CPU / 8 GiB of limits; flag changes that would exceed it (count replicas and rollout surge).
- Attendee Pods in the KWOK seat cluster are not in `deploy/` and are exempt: they request only `conf.io/seat`.
- Keep Service `app` on port 80, and keep the `/healthz` and `/readyz` probes.
- No privileged containers, hostPath, hostNetwork or hostPID.
- The seat apiserver is unauthenticated HTTP: the NetworkPolicy `seats` must keep allowing ingress only from `app: app` pods.
- Argo CD deploys from `main`; don't add steps that apply or patch app manifests on the cluster directly.
- Don't edit `newName`/`newTag` in `deploy/kustomization.yaml` by hand; the build Action owns them.
