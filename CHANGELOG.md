# Changelog

## 0.8.1

### Documentation

- The README names the server key's variables as Ghayma injects them,
  `GHAYMA_AUTH_SERVER_KEY_<SLUG>` and `GHAYMA_AUTH_SERVER_KEY`. No code
  changes: `@ghayma/sdk` 1.5.0 reads these names, and still reads the
  previous ones as a fallback. The `^1.1.0` dependency range resolves it.

## 0.8.0

### Deprecated

- The package is now an alias of `@ghayma/sdk/client` (`@ghayma/sdk` 1.1.0). Every export is re-exported unchanged, so nothing breaks; new code should import from `@ghayma/sdk/client`. No further features will land here.

