cd ~/Projects/THROCT/GHAYMA/Auth-SDK

# 1. Bump the version (0.2.0 → 0.3.0; new feature = minor).
#    Creates the commit + v0.3.0 git tag for you.
npm version minor

# 2. Publish — prepublishOnly runs the tsup build automatically,
#    so there's no separate build step.
npm publish

# 3. Push the version commit + tag to GitHub
git push && git push --tags