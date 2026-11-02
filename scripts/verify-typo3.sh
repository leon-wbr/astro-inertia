#!/usr/bin/env bash
# Starts the TYPO3 DDEV example, runs the TYPO3 e2e tests against it and
# always stops DDEV again.
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
"$root/scripts/typo3.sh" up || { "$root/scripts/typo3.sh" down; exit 1; }
INERTIA_BACKEND="$("$root/scripts/typo3.sh" url)" pnpm --dir "$root" test:e2e:typo3
status=$?
"$root/scripts/typo3.sh" down
exit $status
