# astro-inertia

## Versioning

- SemVer, currently 0.x (highly experimental): a breaking change bumps the minor. The repo has no `breaking` label yet.
- The published package is `packages/astro-inertia`; the version lives in its `package.json`. Bump it in a `chore:` commit, then tag `vX.Y.Z`.
- Releases happen only via `v*` tags: `.github/workflows/release.yml` checks the tag matches that `package.json`, builds, typechecks and tests, then runs `npm publish` with npm trusted publishing (OIDC, no token) and creates a GitHub release with `--generate-notes`. `workflow_dispatch` only dry-runs the trusted-publisher check.
- Release notes come from PR titles, which follow Conventional Commits. There is no CHANGELOG file.
- Never tag a version npm already has (0.1.0 is published), and never move or reuse a pushed tag.
- Open question: 0.1.0 is on npm but the repo has no tag or GitHub release for it, so it was probably published by hand before the workflow existed. Confirm, and decide whether to tag it retroactively.
