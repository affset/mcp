import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { linkInputSchema } from "./linkArgs.js";

describe("linkInputSchema", () => {
  it("trims supported macros without percent-encoding their syntax", () => {
    assert.equal(linkInputSchema.source_click_id.parse("  ${SUBID}  "), "${SUBID}");
    assert.equal(linkInputSchema.cost.parse("  [BID_PRICE]  "), "[BID_PRICE]");
  });

  it("rejects values that would split or truncate the generated query string", () => {
    assert.equal(linkInputSchema.sub1.safeParse("source&cost=10").success, false);
    assert.equal(linkInputSchema.source_click_id.safeParse("token#fragment").success, false);
    assert.equal(linkInputSchema.sub2.safeParse("line\nbreak").success, false);
  });
});
