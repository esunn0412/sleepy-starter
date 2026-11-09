---
title: "kubeseat: no secrets in the repo"
description: "The repo and its image are public; credentials only come from the app-credentials Secret"
type: check
when: "Any PR"
actions: "Comment on any secret, token, API key, password or kubeconfig in code, manifests, Dockerfiles, build args, scripts or logs, and request changes"
---

# No secrets in the repo

- This repository and its container image are public.
- No secrets, tokens, API keys or kubeconfigs in code, manifests, Dockerfiles, build args, scripts or log lines.
- Credentials reach the app only from the `app-credentials` Kubernetes Secret, through `secretKeyRef` environment variables (marked `optional: true` so the app still starts without them).
- Scripts take credentials from the environment, never from command-line arguments.
