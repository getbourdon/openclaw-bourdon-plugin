/**
 * @openclaw/bourdon (community-published as `bourdon-openclaw`)
 *
 * Top-level plugin entry. Wires the SDK-agnostic source modules
 * (manifest-writer, redaction, l6-client, l5-publisher, tools) into
 * OpenClaw's plugin runtime via `definePluginEntry`.
 *
 * The behavior of this entry is:
 *   1. On plugin start: lazily construct a BourdonL6Client (stdio default).
 *   2. Register the six bourdon_* tools as AnyAgentTool entries.
 *   3. (Future) Register a session-end hook that triggers L5 publication.
 *      Hook wiring is currently TODO — pending the right hook event id from
 *      the openclaw plugin SDK; the publisher itself works standalone via
 *      `publishOpenClawL5(...)` exported from src/l5-publisher.ts.
 *   4. On reload/shutdown: close the L6 client subprocess.
 */

import {
  definePluginEntry,
  type AnyAgentTool,
} from "openclaw/plugin-sdk/plugin-entry";
import { jsonResult } from "openclaw/plugin-sdk/core";
import { Type } from "typebox";

import { BourdonL6Client, type L6Config } from "./src/l6-client.js";
import { type BourdonTool, makeBourdonTools } from "./src/tools.js";
import type { Visibility } from "./src/types.js";

interface BourdonPluginConfig {
  library?: string;
  publishOnSessionEnd?: boolean;
  publishCron?: string;
  accessLevel?: Visibility;
  l6?: {
    transport?: "stdio" | "http";
    command?: string;
    args?: string[];
    url?: string;
    spawnTimeoutMs?: number;
  };
  redaction?: {
    snippetCharLimit?: number;
  };
}

function readPluginConfig(raw: unknown): BourdonPluginConfig {
  if (raw === null || typeof raw !== "object") return {};
  return raw as BourdonPluginConfig;
}

function l6ConfigFromPluginConfig(cfg: BourdonPluginConfig): L6Config {
  const l6 = cfg.l6 ?? {};
  if (l6.transport === "http") {
    return {
      transport: "http",
      url: l6.url ?? "http://localhost:7500/sse",
    };
  }
  return {
    transport: "stdio",
    command: l6.command ?? "python",
    args: l6.args ?? ["-m", "core.l6_server"],
    library: cfg.library,
    spawnTimeoutMs: l6.spawnTimeoutMs ?? 5000,
  };
}

/**
 * Convert one of our SDK-agnostic BourdonTool records into the AnyAgentTool
 * shape OpenClaw's runtime expects. Schema → typebox; handler → execute.
 */
function toAnyAgentTool(tool: BourdonTool): AnyAgentTool {
  const propEntries = Object.entries(tool.inputSchema.properties).map(
    ([key, prop]) => {
      let schema;
      switch (prop.type) {
        case "string":
          schema = prop.enum
            ? Type.Union(prop.enum.map((v) => Type.Literal(v)))
            : Type.String();
          break;
        case "boolean":
          schema = Type.Boolean();
          break;
        case "integer":
          schema = Type.Integer();
          break;
        case "number":
          schema = Type.Number();
          break;
        case "array":
          schema = Type.Array(Type.String());
          break;
        default:
          schema = Type.Unknown();
      }
      const required = tool.inputSchema.required?.includes(key) ?? false;
      const annotated = prop.description
        ? Type.Intersect([schema, Type.Unsafe<unknown>({ description: prop.description })])
        : schema;
      const final = required ? annotated : Type.Optional(annotated);
      return [key, final] as const;
    },
  );

  const parameters = Type.Object(Object.fromEntries(propEntries));

  const anyTool: AnyAgentTool = {
    name: tool.name,
    description: tool.description,
    label: humanizeName(tool.name),
    parameters: parameters as never,
    async execute(_toolCallId, params) {
      const argsRecord =
        params && typeof params === "object" && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : {};
      const result = await tool.handler(argsRecord);
      return jsonResult(result);
    },
  };
  return anyTool;
}

function humanizeName(toolName: string): string {
  // bourdon_search → "Bourdon search"
  return toolName
    .split("_")
    .map((part, i) => (i === 0 ? part[0]?.toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export default definePluginEntry({
  id: "bourdon",
  name: "Bourdon — Cross-Agent Memory Federation",
  description:
    "Brings Bourdon's L6 cross-agent memory federation into OpenClaw. " +
    "Publishes openclaw.l5.yaml after sessions and exposes six bourdon_* " +
    "tools (search, cross-agent-summary, recent-work, find-entity, " +
    "recognize, deeper-context) so OpenClaw agents can recall what " +
    "Claude Code, Codex, and Cursor have been doing.",
  register(api) {
    const cfg = readPluginConfig(api.pluginConfig);
    const l6Config = l6ConfigFromPluginConfig(cfg);
    const l6 = new BourdonL6Client(l6Config);

    const tools = makeBourdonTools(l6, {
      defaultAccessLevel: cfg.accessLevel ?? "team",
    });

    for (const tool of tools) {
      api.registerTool(toAnyAgentTool(tool));
    }

    api.logger?.info?.(
      `Bourdon plugin registered ${tools.length} tools (transport=${l6Config.transport}).`,
    );

    // TODO(stream-D, post-Stream-B): wire session-end hook for automatic
    // openclaw.l5.yaml publication. The publisher (src/l5-publisher.ts) works
    // standalone today; the hook wiring needs the canonical event id from
    // the openclaw plugin SDK runtime registry. Captured in the
    // openclaw-integration skill for the follow-up session.
  },
});
