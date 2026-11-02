#!/usr/bin/env bash
# Starts or stops the e2e test fixture: a clone of the DDEV example from
# leon-wbr/inertia-typo3, run as the DDEV project astro-inertia-e2e. It is the
# backend for the TYPO3 e2e tests only; to run examples/typo3 by hand, point it
# at the adapter's own example (see the README).
#
#   scripts/typo3.sh up     clone/update the adapter into .cache/, ddev start, set up and build the site
#   scripts/typo3.sh down   ddev stop
#   scripts/typo3.sh url    print the backend URL
#
# TYPO3_REPO and TYPO3_BRANCH choose what to clone. The clone gets its own
# DDEV project name, so it doesn't clash with a checkout of the adapter.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
repo="${TYPO3_REPO:-https://github.com/leon-wbr/inertia-typo3.git}"
branch="${TYPO3_BRANCH:-main}"
dir="$root/.cache/inertia-typo3"
project="${TYPO3_DDEV_PROJECT:-astro-inertia-e2e}"

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
    # Build the example's Vite assets so TYPO3 has an asset version: the e2e
    # then covers servers that answer 409 to a request without a version.
    (cd "$dir" && ddev exec --dir /var/www/html/example pnpm build)
    (cd "$dir" && ddev exec --dir /var/www/html/example vendor/bin/typo3 cache:flush)
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
