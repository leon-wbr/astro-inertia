#!/usr/bin/env bash
# What CI runs (.github/workflows/ci.yml), plus build and the mock e2e.
# TYPO3 e2e stays opt-in (CI_TYPO3=1) because it needs Docker and DDEV.
# Parallel worktrees: set MOCK_PORT and ASTRO_PORT (and TYPO3_ASTRO_PORT).
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test:e2e:mock
if [[ "${CI_TYPO3:-0}" == 1 ]]; then pnpm verify:typo3; fi
