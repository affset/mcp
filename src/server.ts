import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import { AffsetClient } from "./client.js";
import { DOCS_FEEDS, fetchDocsFeed, type DocsFeed } from "./docs.js";
import { getStats, getStatsInputSchema, GET_STATS_DESCRIPTION } from "./tools/getStats.js";
import { cutZones, cutZonesInputSchema, CUT_ZONES_DESCRIPTION } from "./tools/cutZones.js";
import {
  createCampaign,
  createCampaignInputSchema,
  CREATE_CAMPAIGN_DESCRIPTION,
} from "./tools/createCampaign.js";
import {
  listCampaigns,
  listCampaignsInputSchema,
  LIST_CAMPAIGNS_DESCRIPTION,
} from "./tools/listCampaigns.js";
import { listZones, listZonesInputSchema, LIST_ZONES_DESCRIPTION } from "./tools/listZones.js";
import { listTeam, listTeamInputSchema, LIST_TEAM_DESCRIPTION } from "./tools/listTeam.js";
import {
  createTeamMember,
  createTeamMemberInputSchema,
  CREATE_TEAM_MEMBER_DESCRIPTION,
} from "./tools/createTeamMember.js";
import { createZone, createZoneInputSchema, CREATE_ZONE_DESCRIPTION } from "./tools/createZone.js";
import { getZoneUrl, getZoneUrlInputSchema, GET_ZONE_URL_DESCRIPTION } from "./tools/getZoneUrl.js";
import {
  getTrackingLink,
  getTrackingLinkInputSchema,
  GET_TRACKING_LINK_DESCRIPTION,
} from "./tools/getTrackingLink.js";
import { updateZone, updateZoneInputSchema, UPDATE_ZONE_DESCRIPTION } from "./tools/updateZone.js";
import {
  updateCampaign,
  updateCampaignInputSchema,
  UPDATE_CAMPAIGN_DESCRIPTION,
} from "./tools/updateCampaign.js";
import {
  setCampaignStatus,
  setCampaignStatusInputSchema,
  SET_CAMPAIGN_STATUS_DESCRIPTION,
} from "./tools/setCampaignStatus.js";
import {
  listPayoutRules,
  listPayoutRulesInputSchema,
  LIST_PAYOUT_RULES_DESCRIPTION,
} from "./tools/listPayoutRules.js";
import {
  setPayoutRule,
  setPayoutRuleInputSchema,
  SET_PAYOUT_RULE_DESCRIPTION,
} from "./tools/setPayoutRule.js";
import {
  deletePayoutRule,
  deletePayoutRuleInputSchema,
  DELETE_PAYOUT_RULE_DESCRIPTION,
} from "./tools/deletePayoutRule.js";
import {
  setPayoutGoal,
  setPayoutGoalInputSchema,
  SET_PAYOUT_GOAL_DESCRIPTION,
} from "./tools/setPayoutGoal.js";
import {
  listTargetingTypes,
  listTargetingTypesInputSchema,
  LIST_TARGETING_TYPES_DESCRIPTION,
} from "./tools/listTargetingTypes.js";
import {
  listTargetingRules,
  listTargetingRulesInputSchema,
  LIST_TARGETING_RULES_DESCRIPTION,
} from "./tools/listTargetingRules.js";
import {
  setTargetingRule,
  setTargetingRuleInputSchema,
  SET_TARGETING_RULE_DESCRIPTION,
} from "./tools/setTargetingRule.js";
import {
  removeTargetingRule,
  removeTargetingRuleInputSchema,
  REMOVE_TARGETING_RULE_DESCRIPTION,
} from "./tools/removeTargetingRule.js";
import {
  listSubLabels,
  listSubLabelsInputSchema,
  LIST_SUB_LABELS_DESCRIPTION,
} from "./tools/listSubLabels.js";
import {
  setSubLabels,
  setSubLabelsInputSchema,
  SET_SUB_LABELS_DESCRIPTION,
} from "./tools/setSubLabels.js";
import {
  listConversions,
  listConversionsInputSchema,
  LIST_CONVERSIONS_DESCRIPTION,
} from "./tools/listConversions.js";
import { whoami, whoamiInputSchema, WHOAMI_DESCRIPTION } from "./tools/whoami.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json") as { version: string };

/** Build the MCP server with the affset tools registered against `config`. */
export function createServer(config: Config): McpServer {
  const client = new AffsetClient(config);

  const server = new McpServer({
    name: "affset-mcp",
    version: VERSION,
  });

  // Registers every tool as normal, then immediately removes anything that isn't
  // readOnlyHint:true when AFFSET_READ_ONLY is set — a mutation tool never has a
  // chance to appear in tools/list or be called. See AFFSET_READ_ONLY in the README
  // for why this exists (untrusted third-party data can reach model context via
  // list_conversions/get_stats, so mutation tools are an injection blast-radius
  // control, not just a UI nicety).
  const registerTool: McpServer["registerTool"] = (name, toolConfig, cb) => {
    const tool = server.registerTool(name, toolConfig, cb);
    if (config.readOnly && toolConfig.annotations?.readOnlyHint !== true) {
      tool.remove();
    }
    return tool;
  };

  registerTool(
    "whoami",
    {
      title: "Show the tenant this MCP is bound to",
      description: WHOAMI_DESCRIPTION,
      inputSchema: whoamiInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    () => whoami(client, config),
  );

  registerTool(
    "get_stats",
    {
      title: "Get affset stats",
      description: GET_STATS_DESCRIPTION,
      inputSchema: getStatsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args) => getStats(client, args),
  );

  registerTool(
    "list_campaigns",
    {
      title: "List campaigns",
      description: LIST_CAMPAIGNS_DESCRIPTION,
      inputSchema: listCampaignsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args) => listCampaigns(client, args),
  );

  registerTool(
    "list_zones",
    {
      title: "List zones",
      description: LIST_ZONES_DESCRIPTION,
      inputSchema: listZonesInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args) => listZones(client, args),
  );

  registerTool(
    "list_team",
    {
      title: "List team members",
      description: LIST_TEAM_DESCRIPTION,
      inputSchema: listTeamInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args) => listTeam(client, args),
  );

  registerTool(
    "create_team_member",
    {
      title: "Invite a team member",
      description: CREATE_TEAM_MEMBER_DESCRIPTION,
      inputSchema: createTeamMemberInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => createTeamMember(client, args),
  );

  registerTool(
    "get_zone_url",
    {
      title: "Get the zone URL for a traffic source",
      description: GET_ZONE_URL_DESCRIPTION,
      inputSchema: getZoneUrlInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args) => getZoneUrl(client, config, args),
  );

  registerTool(
    "get_tracking_link",
    {
      title: "Get a campaign's tracking link",
      description: GET_TRACKING_LINK_DESCRIPTION,
      inputSchema: getTrackingLinkInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args) => getTrackingLink(client, config, args),
  );

  registerTool(
    "create_campaign",
    {
      title: "Create a campaign",
      description: CREATE_CAMPAIGN_DESCRIPTION,
      inputSchema: createCampaignInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => createCampaign(client, config, args),
  );

  registerTool(
    "update_campaign",
    {
      title: "Update a campaign",
      description: UPDATE_CAMPAIGN_DESCRIPTION,
      inputSchema: updateCampaignInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => updateCampaign(client, args),
  );

  registerTool(
    "set_campaign_status",
    {
      title: "Run or pause a campaign",
      description: SET_CAMPAIGN_STATUS_DESCRIPTION,
      inputSchema: setCampaignStatusInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => setCampaignStatus(client, args),
  );

  registerTool(
    "create_zone",
    {
      title: "Create a zone",
      description: CREATE_ZONE_DESCRIPTION,
      inputSchema: createZoneInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => createZone(client, args),
  );

  registerTool(
    "update_zone",
    {
      title: "Update a zone",
      description: UPDATE_ZONE_DESCRIPTION,
      inputSchema: updateZoneInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => updateZone(client, args),
  );

  registerTool(
    "cut_zones",
    {
      title: "Cut underperforming zones",
      description: CUT_ZONES_DESCRIPTION,
      inputSchema: cutZonesInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => cutZones(client, args),
  );

  registerTool(
    "list_payout_rules",
    {
      title: "List payout rules",
      description: LIST_PAYOUT_RULES_DESCRIPTION,
      inputSchema: listPayoutRulesInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args) => listPayoutRules(client, args),
  );

  registerTool(
    "set_payout_rule",
    {
      title: "Set a payout rule",
      description: SET_PAYOUT_RULE_DESCRIPTION,
      inputSchema: setPayoutRuleInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => setPayoutRule(client, args),
  );

  registerTool(
    "delete_payout_rule",
    {
      title: "Delete a payout rule",
      description: DELETE_PAYOUT_RULE_DESCRIPTION,
      inputSchema: deletePayoutRuleInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => deletePayoutRule(client, args),
  );

  registerTool(
    "set_payout_goal",
    {
      title: "Set payout goal type",
      description: SET_PAYOUT_GOAL_DESCRIPTION,
      inputSchema: setPayoutGoalInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => setPayoutGoal(client, args),
  );

  registerTool(
    "list_targeting_types",
    {
      title: "List targeting rule types",
      description: LIST_TARGETING_TYPES_DESCRIPTION,
      inputSchema: listTargetingTypesInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    () => listTargetingTypes(client),
  );

  registerTool(
    "list_targeting_rules",
    {
      title: "List campaign targeting rules",
      description: LIST_TARGETING_RULES_DESCRIPTION,
      inputSchema: listTargetingRulesInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args) => listTargetingRules(client, args),
  );

  registerTool(
    "set_targeting_rule",
    {
      title: "Set a targeting rule",
      description: SET_TARGETING_RULE_DESCRIPTION,
      inputSchema: setTargetingRuleInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => setTargetingRule(client, args),
  );

  registerTool(
    "remove_targeting_rule",
    {
      title: "Remove a targeting rule",
      description: REMOVE_TARGETING_RULE_DESCRIPTION,
      inputSchema: removeTargetingRuleInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => removeTargetingRule(client, args),
  );

  registerTool(
    "list_sub_labels",
    {
      title: "List sub labels",
      description: LIST_SUB_LABELS_DESCRIPTION,
      inputSchema: listSubLabelsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    () => listSubLabels(client),
  );

  registerTool(
    "set_sub_labels",
    {
      title: "Set sub labels",
      description: SET_SUB_LABELS_DESCRIPTION,
      inputSchema: setSubLabelsInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => setSubLabels(client, args),
  );

  registerTool(
    "list_conversions",
    {
      title: "List conversions",
      description: LIST_CONVERSIONS_DESCRIPTION,
      inputSchema: listConversionsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args) => listConversions(client, args),
  );

  // Documentation resources. The affset API reference (the same content as the
  // /docs page) is exposed so an assistant can answer "how does X work / how do
  // I call Y" from the docs themselves, not just from the tool schemas above.
  // Fetched from config.docsBaseUrl at read time, so it always reflects the
  // currently published docs. Always registered — read-only by nature, so
  // AFFSET_READ_ONLY doesn't gate them.
  const registerDocsResource = (name: string, uri: string, description: string, feed: DocsFeed) => {
    server.registerResource(
      name,
      uri,
      { title: name, description, mimeType: feed.mimeType },
      async (resourceUri) => ({
        contents: [
          {
            uri: resourceUri.href,
            mimeType: feed.mimeType,
            text: await fetchDocsFeed(config, feed),
          },
        ],
      }),
    );
  };

  registerDocsResource(
    "affset-api-reference",
    "affset://docs/api-reference",
    "The affset HTTP API reference (endpoints, auth, roles, examples) as Markdown — the same content as the /docs page.",
    DOCS_FEEDS.markdown,
  );
  registerDocsResource(
    "affset-api-reference-json",
    "affset://docs/api-reference.json",
    "The affset HTTP API reference as structured JSON, for programmatic use.",
    DOCS_FEEDS.json,
  );

  return server;
}
