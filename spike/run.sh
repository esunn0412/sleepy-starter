#!/usr/bin/env bash
# Builds and runs the spike inside a Kubernetes v1.34.1 source tree, using its
# vendored dependencies (no module downloads needed). Needs Go 1.24+ and git.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="${WORK:-$here/.k8s}"
if [ ! -d "$work" ]; then
  git clone --depth 1 --branch v1.34.1 https://github.com/kubernetes/kubernetes.git "$work"
fi
mkdir -p "$work/cmd/kubeseat-spike"
cp "$here/main.go" "$work/cmd/kubeseat-spike/main.go"
(cd "$work" && go build -mod=vendor -o "$here/kubeseat-spike" ./cmd/kubeseat-spike)
"$here/kubeseat-spike" "$@"
