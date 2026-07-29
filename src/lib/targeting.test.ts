import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeRuleValue,
  resolveTargetingType,
  toSyncPayload,
  UNENFORCED_TYPES,
} from "./targeting.js";
import type { TargetingRule, TargetingRuleType } from "../types.js";

const TYPES: TargetingRuleType[] = [
  { id: 1, name: "geo", description: "Target by country" },
  { id: 2, name: "device_type", description: null },
  { id: 8, name: "hours", description: null },
];

function value(result: ReturnType<typeof normalizeRuleValue>): string {
  assert.ok(!("error" in result), `expected a value, got: ${JSON.stringify(result)}`);
  return result.value;
}

function notes(result: ReturnType<typeof normalizeRuleValue>): string[] {
  assert.ok(!("error" in result));
  return result.notes;
}

describe("normalizeRuleValue", () => {
  it("rewrites values to the spelling the serve path compares against", () => {
    // CF-IPCountry is upper-case and matched with an exact string compare.
    assert.equal(value(normalizeRuleValue("geo", " br , mx ")), "BR,MX");
    assert.equal(value(normalizeRuleValue("device_type", "Mobile,DESKTOP")), "mobile,desktop");
    assert.equal(value(normalizeRuleValue("os", "android, ios")), "Android,iOS");
    assert.equal(value(normalizeRuleValue("browser", "chrome")), "Chrome");
    assert.equal(value(normalizeRuleValue("unique_users", "3,12")), "3/12");
    assert.equal(value(normalizeRuleValue("unique_users", "1")), "1/24");
  });

  it("reports what it rewrote and de-duplicates", () => {
    const result = normalizeRuleValue("geo", "br,BR,mx");
    assert.equal(value(result), "BR,MX");
    assert.match(notes(result)[0] ?? "", /Normalised/);
  });

  it("says nothing when the value was already canonical", () => {
    assert.deepEqual(notes(normalizeRuleValue("geo", "BR,MX")), []);
  });

  it("rejects values that could never match", () => {
    assert.ok("error" in normalizeRuleValue("geo", "Brazil"));
    assert.ok("error" in normalizeRuleValue("device_type", "phone"));
    assert.ok("error" in normalizeRuleValue("zone_id", "not-a-uuid"));
    assert.ok("error" in normalizeRuleValue("unique_users", "3 per day"));
    assert.ok("error" in normalizeRuleValue("unique_users", "0/24"));
    assert.ok("error" in normalizeRuleValue("unique_users", "1/99999"));
    assert.ok("error" in normalizeRuleValue("geo", "   "));
  });

  it("accepts zone UUIDs and the legacy zone-{id} form", () => {
    const uuid = "6f2b7d3c-6c1e-4a2b-9f2a-1b7c8d9e0f11";
    assert.equal(value(normalizeRuleValue("zone_id", `${uuid}, zone-7`)), `${uuid},zone-7`);
  });

  it("passes unknown os/browser names through with a warning rather than guessing", () => {
    // Brave is the case that has to stay unmapped: it is a real browser the
    // serve path reports as Chrome, so resolving it would widen the campaign to
    // every Chrome user instead of the audience it asked for.
    const result = normalizeRuleValue("browser", "Brave");
    assert.equal(value(result), "Brave");
    assert.match(notes(result).join(" "), /not a browser name this server recognises/);
  });

  it("resolves the ids the dashboard's selectors used to write", () => {
    assert.equal(value(normalizeRuleValue("os", "windows_10,windows_11")), "Windows");
    assert.equal(value(normalizeRuleValue("os", "chrome_os")), "Chrome OS");
    assert.equal(
      value(normalizeRuleValue("browser", "samsung_internet,uc,yandex,vivaldi")),
      "Samsung Internet for Android,UC Browser,Yandex Browser,Vivaldi",
    );
  });

  it("leaves types it has no vocabulary for untouched", () => {
    assert.equal(value(normalizeRuleValue("something_new", "a,b")), "a,b");
  });
});

describe("resolveTargetingType", () => {
  it("resolves by id, by numeric string, and by case-insensitive name", () => {
    for (const input of [1, "1", "GEO"] as const) {
      const resolved = resolveTargetingType(TYPES, input);
      assert.ok(!("error" in resolved));
      assert.equal(resolved.type.name, "geo");
    }
  });

  it("lists what is available when the type is unknown", () => {
    const byName = resolveTargetingType(TYPES, "country");
    assert.ok("error" in byName);
    assert.match(byName.error, /geo, device_type, hours/);

    const byId = resolveTargetingType(TYPES, 99);
    assert.ok("error" in byId);
    assert.match(byId.error, /1=geo/);
  });
});

describe("UNENFORCED_TYPES", () => {
  it("covers the seeded types /serve never evaluates", () => {
    assert.deepEqual(Object.keys(UNENFORCED_TYPES).sort(), ["capping", "hours", "weekdays"]);
  });
});

describe("toSyncPayload", () => {
  it("keeps ids (the endpoint deletes anything omitted) and drops the rest", () => {
    const rules: TargetingRule[] = [
      {
        id: 5,
        campaign_id: 42,
        targeting_rule_type_id: 1,
        targeting_method: "whitelist",
        rule: "BR",
      },
      { targeting_rule_type_id: 2, targeting_method: "blacklist", rule: "tablet" },
    ];
    assert.deepEqual(toSyncPayload(rules), [
      { id: 5, targeting_rule_type_id: 1, targeting_method: "whitelist", rule: "BR" },
      { targeting_rule_type_id: 2, targeting_method: "blacklist", rule: "tablet" },
    ]);
  });
});
