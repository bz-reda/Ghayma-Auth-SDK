/**
 * @ghayma/auth — deprecated alias.
 *
 * The browser auth SDK now ships inside `@ghayma/sdk` as the `client` entry.
 * This package re-exports it unchanged so existing imports keep working.
 * Migrate by changing the import:
 *
 *   import { GhaymaAuth } from "@ghayma/sdk/client";
 *
 * @deprecated use `@ghayma/sdk/client`
 * @packageDocumentation
 */
export * from "@ghayma/sdk/client";
