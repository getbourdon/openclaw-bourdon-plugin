/**
 * The six `bourdon_*` tools the plugin exposes to OpenClaw agents.
 *
 * Each tool is defined as a `BourdonTool` — a self-contained record holding
 * the tool's name, description, input schema (JSON Schema), and a handler
 * that proxies to the L6 client. Wrapping into OpenClaw's `AnyAgentTool`
 * shape happens in `index.ts` where the plugin SDK is in scope; that keeps
 * this module SDK-agnostic and unit-testable.
 *
 * Tool surface mirrors bourdon/core/l6_server.py (six MCP tools).
 */

import type { BourdonL6Client, L6ToolResult } from "./l6-client.js";
import type { Visibility } from "./types.js";

/** SDK-agnostic tool record. Wrapped to AnyAgentTool by index.ts. */
export interface BourdonTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  handler: (args: Record<string, unknown>) => Promise<L6ToolResult>;
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JsonSchemaProperty {
  type: "string" | "boolean" | "integer" | "number" | "array";
  description?: string;
  enum?: readonly string[];
  default?: unknown;
  items?: JsonSchemaProperty;
}

const VISIBILITY_VALUES = ["public", "team", "private"] as const satisfies readonly Visibility[];

const ACCESS_LEVEL_PROPERTY: JsonSchemaProperty = {
  type: "string",
  enum: VISIBILITY_VALUES,
  default: "team",
  description:
    "Visibility scope for this query. 'team' is the default. Private entities are filtered at the L6 layer regardless.",
};

const INCLUDE_PRIVATE_PROPERTY: JsonSchemaProperty = {
  type: "boolean",
  default: false,
  description:
    "When true, query results may include entities tagged 'private' that the caller has access to.",
};

export interface ToolFactoryOptions {
  /** Default access level when the caller doesn't specify one. */
  defaultAccessLevel?: Visibility;
}

/** Build the six bourdon_* tools from a live L6 client. */
export function makeBourdonTools(
  l6: BourdonL6Client,
  options: ToolFactoryOptions = {},
): BourdonTool[] {
  const fallback: Visibility = options.defaultAccessLevel ?? "team";

  function applyDefaults<A extends { access_level?: Visibility }>(args: A): A {
    if (!args.access_level) {
      args.access_level = fallback;
    }
    return args;
  }

  return [
    {
      name: "bourdon_search",
      description:
        "Search a specific Bourdon-equipped agent's L5 manifest for entities and recent work matching a topic. Use when the user asks a question about a specific agent ('What did Codex work on?').",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          agent: {
            type: "string",
            description:
              "Agent id (e.g., 'codex', 'claude-code', 'cursor', 'openclaw').",
          },
          topic: {
            type: "string",
            description: "Search term — entity name, project, concept.",
          },
          access_level: ACCESS_LEVEL_PROPERTY,
          include_private: INCLUDE_PRIVATE_PROPERTY,
        },
        required: ["agent", "topic"],
      },
      handler: async (args) => l6.queryAgentMemory(applyDefaults(args as never)),
    },

    {
      name: "bourdon_cross_agent_summary",
      description:
        "Summarize a project's state across every Bourdon-equipped agent that's worked on it. Returns a federated narrative of who did what.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          project: {
            type: "string",
            description: "Project name or identifier (e.g., 'PRUN', 'Bourdon').",
          },
          access_level: ACCESS_LEVEL_PROPERTY,
          include_private: INCLUDE_PRIVATE_PROPERTY,
        },
        required: ["project"],
      },
      handler: async (args) =>
        l6.getCrossAgentSummary(applyDefaults(args as never)),
    },

    {
      name: "bourdon_recent_work",
      description:
        "List recent sessions across all Bourdon-equipped agents (or filtered to one) since a date. Use for 'what's been happening this week' style queries.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          since: {
            type: "string",
            description:
              "ISO 8601 date or datetime (e.g., '2026-05-01' or '2026-05-01T00:00:00Z'). Optional.",
          },
          agent: {
            type: "string",
            description: "Optional agent id to scope the query to one agent.",
          },
          access_level: ACCESS_LEVEL_PROPERTY,
          include_private: INCLUDE_PRIVATE_PROPERTY,
        },
        required: [],
      },
      handler: async (args) => l6.listRecentWork(applyDefaults(args as never)),
    },

    {
      name: "bourdon_find_entity",
      description:
        "Look up an entity (project, file, concept, person) across every Bourdon-equipped agent. Returns each place the entity has been touched, with timestamps.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: {
            type: "string",
            description: "Entity name to look up.",
          },
          access_level: ACCESS_LEVEL_PROPERTY,
          include_private: INCLUDE_PRIVATE_PROPERTY,
        },
        required: ["name"],
      },
      handler: async (args) => l6.findEntity(applyDefaults(args as never)),
    },

    {
      name: "bourdon_recognize",
      description:
        "Format a Bourdon recognition payload for a given prompt — the recognition-first runtime hook. Use this BEFORE issuing the agent's main response so recognition fires first (matches Bourdon's 'recognition first, hydration second' thesis).",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          prompt: {
            type: "string",
            description: "User prompt to recognize against.",
          },
          access_level: ACCESS_LEVEL_PROPERTY,
          include_private: INCLUDE_PRIVATE_PROPERTY,
        },
        required: ["prompt"],
      },
      handler: async (args) =>
        l6.prepareRecognitionContext(applyDefaults(args as never)),
    },

    {
      name: "bourdon_deeper_context",
      description:
        "Pull deeper episodic context (L2) for a prompt when the agent has the response time to wait for it. Slower than bourdon_recognize; richer payload.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          prompt: {
            type: "string",
            description: "User prompt to enrich with deeper context.",
          },
          access_level: ACCESS_LEVEL_PROPERTY,
          include_private: INCLUDE_PRIVATE_PROPERTY,
        },
        required: ["prompt"],
      },
      handler: async (args) =>
        l6.getDeeperContext(applyDefaults(args as never)),
    },
  ];
}
