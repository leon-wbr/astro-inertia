#!/usr/bin/env bash
# Starts or stops the TYPO3 DDEV example from leon-wbr/inertia-typo3, the
# real backend for examples/typo3 and the TYPO3 e2e tests.
#
#   scripts/typo3.sh up     clone/update the adapter branch into .cache/, ddev start, set up the site
#   scripts/typo3.sh down   ddev stop
#   scripts/typo3.sh url    print the backend URL
#
# TYPO3_REPO and TYPO3_BRANCH choose what to clone. The clone gets its own
# DDEV project name, so it doesn't clash with a checkout of the adapter.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
repo="${TYPO3_REPO:-https://github.com/leon-wbr/inertia-typo3.git}"
branch="${TYPO3_BRANCH:-feat/typo3-14-inertia-3}"
dir="$root/.cache/inertia-typo3"
project="${TYPO3_DDEV_PROJECT:-astro-inertia-typo3}"

case "${1:-}" in
  up)
    if [[ -d "$dir/.git" ]]; then
      git -C "$dir" fetch --depth 1 origin "$branch"
      git -C "$dir" checkout -q --force -B "$branch" FETCH_HEAD
    else
      mkdir -p "$root/.cache"
      git clone --depth 1 --branch "$branch" --single-branch "$repo" "$dir"
    fi
    echo "inertia-typo3 at $(git -C "$dir" rev-parse --short HEAD) ($branch)"
    printf 'name: %s\n' "$project" > "$dir/.ddev/config.local.yaml"
    (cd "$dir" && ddev start -y && ddev setup-example)
    echo "TYPO3 ready at http://$project.ddev.site"
    ;;
  down)
    if [[ -d "$dir/.ddev" ]]; then (cd "$dir" && ddev stop); fi
    ;;
  url)
    echo "http://$project.ddev.site"
    ;;
  *)
    echo "usage: $0 up|down|url" >&2
    exit 2
    ;;
esac
