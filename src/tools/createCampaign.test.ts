import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AffsetClient } from "../client.js";
import type { Config } from "../config.js";
import type { CreateCampaignResponse, TenantSettingsResponse, Zone } from "../types.js";
import { createCampaign } from "./createCampaign.js";

const CONFIG: Config = {
  baseUrl: "https://api.affset.com",
  docsBaseUrl: "https://affset.com",
  apiKey: "test-key",
  namespace: "test",
  requestTimeoutMs: 1_000,
  readOnly: false,
};

function fakeClient() {
  const posts: Array<{ path: string; body: unknown }> = [];
  const zone: Zone = { id: "zone-1", name: "Primary", status: "active" };
  const tenant: TenantSettingsResponse = {};
  const created: CreateCampaignResponse = {
    id: 42,
    name: "Offer",
    status: "paused",
    created_at: Date.UTC(2026, 6, 29),
  };
  const client = {
    get: async (path: string) => {
      if (path === "/api/zones/zone-1") return zone;
      if (path === "/api/tenant") return tenant;
      throw new Error(`Unexpected GET: ${path}`);
    },
    post: async (path: string, body: unknown) => {
      posts.push({ path, body });
      if (path === "/api/campaigns") return created;
      throw new Error(`Unexpected POST: ${path}`);
    },
  } as unknown as AffsetClient;
  return { client, posts };
}

describe("createCampaign confirmation", () => {
  it("does not write during the default dry run", async () => {
    const { client, posts } = fakeClient();
    const result = await createCampaign(client, CONFIG, {
      user_email: "buyer@example.com",
      offer_url: "https://offer.example/landing",
      zone_id: "zone-1",
      confirm: false,
    });

    assert.equal(result.isError, undefined);
    assert.equal(posts.length, 0);
  });

  it("creates exactly once after confirmation", async () => {
    const { client, posts } = fakeClient();
    const result = await createCampaign(client, CONFIG, {
      user_email: "buyer@example.com",
      offer_url: "https://offer.example/landing",
      zone_id: "zone-1",
      confirm: true,
    });

    assert.equal(result.isError, undefined);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.path, "/api/campaigns");
  });
});
