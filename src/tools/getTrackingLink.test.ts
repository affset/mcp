import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AffsetClient } from "../client.js";
import type { Config } from "../config.js";
import type { Campaign, TenantSettingsResponse, Zone } from "../types.js";
import { getTrackingLink } from "./getTrackingLink.js";

const CONFIG: Config = {
  baseUrl: "https://api.affset.com",
  docsBaseUrl: "https://affset.com",
  apiKey: "test-key",
  namespace: "test",
  requestTimeoutMs: 1_000,
  readOnly: false,
};

function responseText(result: Awaited<ReturnType<typeof getTrackingLink>>): string {
  const block = result.content[0];
  assert.ok(block && block.type === "text");
  return block.text;
}

describe("getTrackingLink", () => {
  it("makes the paused-campaign 404 behavior explicit", async () => {
    const campaign: Campaign = {
      id: 42,
      name: "Paused campaign",
      status: "paused",
      redirect_url: "https://offer.example",
    };
    const zone: Zone = { id: "zone-1", name: "Source", status: "active" };
    const tenant: TenantSettingsResponse = {};
    const client = {
      get: async (path: string) => {
        if (path === "/api/campaigns/42") return campaign;
        if (path === "/api/zones/zone-1") return zone;
        if (path === "/api/tenant") return tenant;
        throw new Error(`Unexpected path: ${path}`);
      },
    } as unknown as AffsetClient;

    const result = await getTrackingLink(client, CONFIG, { campaign_id: 42, zone_id: "zone-1" });
    const text = responseText(result);

    assert.match(text, /paused — this link returns 404 until the campaign is run/);
    assert.match(text, /https:\/\/api\.affset\.com\/track\/click\/42\/zone-1/);
  });
});
