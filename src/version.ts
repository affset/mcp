/**
 * Package version, duplicated from package.json so the core stays importable
 * on runtimes without Node's module APIs (Workers). createRequire-reading
 * package.json here would break bundlers; a sync test guards the duplicate
 * (see registerTools.test.ts).
 */
export const VERSION = "0.2.1";
