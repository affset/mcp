import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AffsetClient } from "../client.js";
import type { CreateZoneResponse, Zone } from "../types.js";
import { createZone } from "./createZone.js";

function fakeClient() {
  const posts: Array<{ path: string; body: unknown }> = [];
  const created: CreateZoneResponse = {
    id: "zone-1",
    status: "active",
    created_at: Date.UTC(2026, 6, 29),
  };
  const zone: Zone = { id: "zone-1", name: "Source", status: "active" };
  const client = {
    post: async (path: string, body: unknown) => {
      posts.push({ path, body });
      return created;
    },
    get: async () => zone,
  } as unknown as AffsetClient;
  return { client, posts };
}

describe("createZone confirmation", () => {
  it("does not write during the default dry run", async () => {
    const { client, posts } = fakeClient();
    const result = await createZone(client, { name: "Source", confirm: false });

    assert.equal(result.isError, undefined);
    assert.equal(posts.length, 0);
  });

  it("creates exactly once after confirmation", async () => {
    const { client, posts } = fakeClient();
    const result = await createZone(client, { name: "Source", confirm: true });

    assert.equal(result.isError, undefined);
    assert.deepEqual(posts, [{ path: "/api/zones", body: { name: "Source" } }]);
  });
});
