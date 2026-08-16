import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { VERSION } from "./version.js";

interface PackageJson {
  name: string;
  version: string;
  mcpName: string;
}

interface PackageLock {
  name: string;
  version: string;
  packages: Record<string, { name?: string; version?: string }>;
}

interface ServerJson {
  name: string;
  version: string;
  websiteUrl: string;
  remotes: Array<{
    type: string;
    url: string;
    headers?: unknown;
  }>;
  packages: Array<{
    registryType: string;
    identifier: string;
    version?: string;
    transport: { type: string };
  }>;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as T;
}

describe("MCP Registry metadata", () => {
  it("keeps package and server identities aligned", () => {
    const packageJson = readJson<PackageJson>("../package.json");
    const packageLock = readJson<PackageLock>("../package-lock.json");
    const serverJson = readJson<ServerJson>("../server.json");
    const registryPackage = serverJson.packages.find(
      ({ registryType, identifier }) => registryType === "npm" && identifier === packageJson.name,
    );

    assert.ok(registryPackage, "server.json must declare the npm package");
    assert.equal(packageJson.mcpName, serverJson.name);
    assert.equal(packageJson.version, serverJson.version);
    assert.equal(packageJson.version, VERSION);
    assert.equal(packageJson.version, registryPackage.version);
    assert.equal(packageJson.version, packageLock.version);
    assert.equal(packageJson.name, packageLock.name);
    assert.equal(packageJson.version, packageLock.packages[""].version);
    assert.equal(packageJson.name, packageLock.packages[""].name);
    assert.equal(registryPackage.transport.type, "stdio");
    assert.equal(serverJson.websiteUrl, "https://affset.com/integrations");
    assert.equal(serverJson.remotes.length, 1);
    const remote = serverJson.remotes[0];
    assert.equal(remote.type, "streamable-http");
    assert.equal(remote.url, "https://mcp.affset.com/mcp");
    // A static Authorization (or other) header would make clients prompt for a
    // token instead of discovering OAuth from the hosted endpoint.
    assert.equal("headers" in remote, false);
  });
});
