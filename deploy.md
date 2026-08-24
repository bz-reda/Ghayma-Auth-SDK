cd ~/Projects/THROCT/GHAYMA/Auth-SDK

# 0. ALWAYS publish from the merged main:
git checkout main && git pull
#    (2026-08-24 near-miss: a stale local main — two unpushed version-only
#    commits, missing the merged feature PR — was one npm login away from
#    shipping old code under the new version number.)

# 1. Check package.json FIRST: feature PRs usually bump the version already.
#    If it already carries the new version, SKIP npm version and only tag:
#      git tag v<version>
#    Otherwise bump (new feature = minor; creates the commit + tag for you):
npm version minor

# 2. Publish — prepublishOnly runs the tsup build automatically,
#    so there's no separate build step.
npm publish

# 3. Push the version commit + tag to GitHub
git push && git push --tags