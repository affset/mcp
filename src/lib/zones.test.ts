import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AffsetClient } from "../client.js";
import type { Zone, ZonesResponse } from "../types.js";
import { resolveZone } from "./zones.js";

function mockClient(
  get: (path: string, query?: Record<string, string | number | undefined>) => Promise<unknown>,
): AffsetClient {
  return { get } as unknown as AffsetClient;
}

describe("resolveZone", () => {
  it("uses the API's active filter and auto-picks the only active zone in one request", async () => {
    let seenQuery: Record<string, string | number | undefined> | undefined;
    const zone: Zone = { id: "zone-1", name: "Primary", status: "active" };
    const client = mockClient(async (_path, query) => {
      seenQuery = query;
      return {
        zones: [zone],
        pagination: { total: 1, limit: 25, offset: 0, has_more: false },
      } satisfies ZonesResponse;
    });

    assert.deepEqual(await resolveZone(client, undefined), { zone });
    assert.deepEqual(seenQuery, {
      status: "active",
      limit: 25,
      offset: 0,
      sort: "name",
      order: "asc",
    });
  });

  it("uses pagination.total to report choices without fetching every active zone", async () => {
    const zones: Zone[] = Array.from({ length: 25 }, (_, index) => ({
      id: `zone-${index + 1}`,
      name: `Zone ${index + 1}`,
      status: "active",
    }));
    let calls = 0;
    const client = mockClient(async () => {
      calls += 1;
      return {
        zones,
        pagination: { total: 30, limit: 25, offset: 0, has_more: true },
      } satisfies ZonesResponse;
    });

    const result = await resolveZone(client, undefined);
    assert.ok("error" in result);
    assert.match(result.error, /and 5 more/);
    assert.equal(calls, 1);
  });

  it("warns that an inactive zone disables both public URL types", async () => {
    const zone: Zone = { id: "zone-1", name: "Old", status: "inactive" };
    const client = mockClient(async () => zone);

    const result = await resolveZone(client, " zone-1 ");
    assert.ok("zone" in result);
    assert.match(
      result.inactiveWarning ?? "",
      /both \/serve and direct \/track\/click URLs return 404/,
    );
  });
});
