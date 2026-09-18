/**
 * Vitest stand-in for the `server-only` package. In the app that import
 * throws when a module is pulled into a client bundle — the tripwire we want.
 * Vitest is neither a server nor a client bundle, so the real package throws
 * on every import; this empty module takes its place there (vitest.config.ts).
 */
export {};
