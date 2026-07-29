import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTrackingLink,
  buildZoneUrl,
  integrationBaseUrl,
  placeholderName,
  subLegend,
} from "./integrationUrls.js";

const BASE = "https://api.affset.com";
const ZONE = "zone-abc";
const LABELS = { sub1: "Creative", sub2: "Placement ID" };
const ALL_SUBS = "sub1={sub1}&sub2={sub2}&sub3={sub3}&sub4={sub4}&sub5={sub5}";

describe("integrationBaseUrl", () => {
  it("falls back to the API base when no custom domain is set", () => {
    assert.equal(integrationBaseUrl(undefined, BASE), BASE);
    assert.equal(integrationBaseUrl(null, BASE), BASE);
    assert.equal(integrationBaseUrl("  ", BASE), BASE);
  });

  it("adds a scheme and strips the trailing slash", () => {
    assert.equal(integrationBaseUrl("track.mybrand.com", BASE), "https://track.mybrand.com");
    assert.equal(
      integrationBaseUrl("https://track.mybrand.com/", BASE),
      "https://track.mybrand.com",
    );
  });

  it("rejects unparseable or non-http custom domains rather than emitting a broken URL", () => {
    // custom_api_domain is tenant-editable free text, so it can be anything.
    assert.equal(integrationBaseUrl("not a url", BASE), BASE);
    assert.equal(integrationBaseUrl("javascript:alert(1)", BASE), BASE);
    assert.equal(integrationBaseUrl("ftp://files.example.com", BASE), BASE);
    assert.equal(integrationBaseUrl("https://good.example@evil.example", BASE), BASE);
    assert.equal(integrationBaseUrl("track.mybrand.com/path", BASE), BASE);
  });
});

describe("buildZoneUrl", () => {
  it("defaults to the RichAds click macro and a full sub template", () => {
    assert.equal(
      buildZoneUrl(BASE, ZONE),
      `${BASE}/serve/${ZONE}?source_click_id={clickid}&${ALL_SUBS}`,
    );
  });

  it("names sub placeholders after the tenant's labels", () => {
    assert.equal(
      buildZoneUrl(BASE, ZONE, { subLabels: LABELS }),
      `${BASE}/serve/${ZONE}?source_click_id={clickid}&sub1={creative}&sub2={placement_id}` +
        "&sub3={sub3}&sub4={sub4}&sub5={sub5}",
    );
  });

  it("keeps network macros verbatim — encoding them would break substitution", () => {
    const url = buildZoneUrl(BASE, ZONE, {
      sourceClickId: "${SUBID}",
      subs: { sub1: "[CREATIVE_ID]" },
      cost: "{cost}",
    });
    assert.match(url, /\?source_click_id=\$\{SUBID\}&sub1=\[CREATIVE_ID\]/);
    assert.match(url, /&cost=\{cost\}$/);
  });

  it("omits source_click_id only when explicitly blanked", () => {
    assert.equal(
      buildZoneUrl(BASE, ZONE, { sourceClickId: "" }),
      `${BASE}/serve/${ZONE}?${ALL_SUBS}`,
    );
  });

  it("escapes the zone id in the path", () => {
    assert.match(buildZoneUrl(BASE, "a b/c"), /\/serve\/a%20b%2Fc\?/);
  });

  it("does not produce a double slash when the base has a trailing slash", () => {
    assert.match(buildZoneUrl(`${BASE}/`, ZONE), new RegExp(`^${BASE}/serve/`));
  });
});

describe("buildTrackingLink", () => {
  it("matches the link create_campaign has always emitted", () => {
    assert.equal(
      buildTrackingLink(BASE, 42, ZONE, { subLabels: LABELS }),
      `${BASE}/track/click/42/${ZONE}?source_click_id={clickid}&sub1={creative}` +
        "&sub2={placement_id}&sub3={sub3}&sub4={sub4}&sub5={sub5}",
    );
  });

  it("accepts a string campaign id", () => {
    assert.match(buildTrackingLink(BASE, "42", ZONE), /\/track\/click\/42\/zone-abc\?/);
  });

  it("normalizes a trailing slash on the base", () => {
    assert.match(buildTrackingLink(`${BASE}/`, 42, ZONE), new RegExp(`^${BASE}/track/click/`));
  });
});

describe("placeholderName", () => {
  it("slugifies a label and falls back to the raw key", () => {
    assert.equal(placeholderName("sub1", "Creative name"), "creative_name");
    // Separators collapse to the underscore that replaced the spaces around them.
    assert.equal(placeholderName("sub1", "Zone / Site!"), "zone__site");
    assert.equal(placeholderName("sub3", undefined), "sub3");
    assert.equal(placeholderName("sub3", "   "), "sub3");
    // A label of pure punctuation slugs to nothing — must not yield "{}".
    assert.equal(placeholderName("sub4", "!!!"), "sub4");
  });
});

describe("subLegend", () => {
  it("lists labelled and explicitly-set slots, and returns null when there is nothing to say", () => {
    assert.equal(subLegend(LABELS), "`sub1` = Creative · `sub2` = Placement ID");
    assert.equal(
      subLegend(LABELS, { sub1: "banner_7" }),
      "`sub1` = banner_7 (Creative) · `sub2` = Placement ID",
    );
    assert.equal(subLegend({}, {}), null);
  });

  it("does not let labels or values break the surrounding markdown table", () => {
    assert.equal(
      subLegend({ sub1: "Creative | ID" }, { sub1: "banner|7" }),
      "`sub1` = banner\\|7 (Creative \\| ID)",
    );
    assert.equal(subLegend({}, { sub1: "   " }), null);
  });
});
