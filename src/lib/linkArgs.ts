/**
 * Input shape shared by the two integration-URL tools. Both hand a URL to a traffic
 * source, so both take the same knobs: which click-token macro to use, what to put
 * in the five sub slots, and whether to import the network's cost macro.
 */

import { z } from "zod";
import { SUB_KEYS, type SubKey } from "../types.js";
import { DEFAULT_SOURCE_CLICK_ID, type SubValues } from "./integrationUrls.js";

const LINK_VALUE_MAX = 255;

/**
 * Values are deliberately not percent-encoded so ad-network macro syntax survives.
 * Reject characters that would instead terminate or split the generated query value.
 */
const linkValue = (label: string) =>
  z
    .string()
    .trim()
    .max(LINK_VALUE_MAX)
    // eslint-disable-next-line no-control-regex -- matching control chars is the point: reject them.
    .refine((value) => !/[&#\u0000-\u001f\u007f]/.test(value), {
      message: `${label} cannot contain &, #, or control characters; percent-encode literal separators.`,
    });

/** Sub slots are declared one by one so the model can see all five. */
const subSchema = (key: SubKey) =>
  linkValue(key)
    .optional()
    .describe(
      `Value or macro for ${key} (analytics only). Defaults to a placeholder named ` +
        "after the tenant's label for this slot.",
    );

export const linkInputSchema = {
  source_click_id: linkValue("source_click_id")
    .optional()
    .describe(
      "The traffic source's click-token macro, e.g. `{clickid}` (RichAds), `[CLICK_ID]`, " +
        `\`\${SUBID}\`. Default \`${DEFAULT_SOURCE_CLICK_ID}\`. This is what conversion ` +
        'postbacks echo back via {source_click_id} — pass "" only to omit it deliberately.',
    ),
  cost: linkValue("cost")
    .optional()
    .describe(
      "The network's cost macro, e.g. `{cost}`. Adds `&cost=…` so media cost is imported " +
        "and ROI shows up in get_stats. Omit if the source cannot pass cost.",
    ),
  sub1: subSchema("sub1"),
  sub2: subSchema("sub2"),
  sub3: subSchema("sub3"),
  sub4: subSchema("sub4"),
  sub5: subSchema("sub5"),
};

export type LinkArgs = {
  source_click_id?: string;
  cost?: string;
  sub1?: string;
  sub2?: string;
  sub3?: string;
  sub4?: string;
  sub5?: string;
};

/** Pull the flat sub1..sub5 args into the record the URL builders take. */
export function collectSubs(args: LinkArgs): SubValues {
  const subs: SubValues = {};
  for (const key of SUB_KEYS) {
    const value = args[key];
    if (value !== undefined) subs[key] = value;
  }
  return subs;
}
