import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

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
    assert.equal(packageJson.version, registryPackage.version);
    assert.equal(packageJson.version, packageLock.version);
    assert.equal(packageJson.name, packageLock.name);
    assert.equal(packageJson.version, packageLock.packages[""].version);
    assert.equal(packageJson.name, packageLock.packages[""].name);
    assert.equal(registryPackage.transport.type, "stdio");
  });
});
