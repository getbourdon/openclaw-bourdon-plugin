/**
 * Bourdon L6 MCP client.
 *
 * Spawns `python -m core.l6_server` as a stdio subprocess (default) or
 * connects to a long-lived HTTP/SSE service, then proxies the six L6 tools
 * the server exposes. Wraps the official @modelcontextprotocol/sdk client so
 * we don't re-implement JSON-RPC framing.
 *
 * The L6 tool surface (mirrored from bourdon/core/l6_server.py:411-459):
 *   - query_agent_memory(agent, topic, access_level, include_private)
 *   - list_recent_work(since, agent, access_level, include_private)
 *   - find_entity(name, access_level, include_private)
 *   - get_cross_agent_summary(project, access_level, include_private)
 *   - prepare_recognition_context(prompt, access_level, include_private)
 *   - get_deeper_context(prompt, access_level, include_private)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { Visibility } from "./types.js";

export interface L6StdioConfig {
  transport: "stdio";
  command?: string;
  args?: string[];
  /** Optional library path forwarded to L6 via --library. */
  library?: string;
  /** Initial connect timeout in ms. */
  spawnTimeoutMs?: number;
  /** Optional environment passed to the subprocess. */
  env?: Record<string, string>;
}

export interface L6HttpConfig {
  transport: "http";
  url: string;
}

export type L6Config = L6StdioConfig | L6HttpConfig;

export interface L6ToolArgs {
  access_level?: Visibility;
  include_private?: boolean;
}

export interface QueryAgentMemoryArgs extends L6ToolArgs {
  agent: string;
  topic: string;
}

export interface ListRecentWorkArgs extends L6ToolArgs {
  /** ISO 8601 date or datetime. */
  since?: string;
  agent?: string;
}

export interface FindEntityArgs extends L6ToolArgs {
  name: string;
}

export interface GetCrossAgentSummaryArgs extends L6ToolArgs {
  project: string;
}

export interface RecognitionArgs extends L6ToolArgs {
  prompt: string;
}

/** Whatever shape L6 returns. We deliberately keep it loose at the wire layer. */
export type L6ToolResult = unknown;

export class BourdonL6Client {
  private client: Client | null = null;
  private transport: Transport | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly config: L6Config;

  constructor(config: L6Config) {
    this.config = config;
  }

  /** Connect lazily on first call; subsequent calls reuse the live client. */
  private async ensureConnected(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connectPromise) {
      await this.connectPromise;
      if (!this.client) {
        throw new Error("Bourdon L6 client failed to initialize");
      }
      return this.client;
    }
    this.connectPromise = this.connect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
    if (!this.client) {
      throw new Error("Bourdon L6 client failed to initialize");
    }
    return this.client;
  }

  private async connect(): Promise<void> {
    const transport = this.buildTransport(this.config);
    const client = new Client(
      { name: "bourdon-openclaw", version: "0.1.0" },
      { capabilities: {} },
    );
    await client.connect(transport);
    this.client = client;
    this.transport = transport;
  }

  private buildTransport(config: L6Config): Transport {
    if (config.transport === "stdio") {
      const args = [...(config.args ?? ["-m", "core.l6_server"])];
      if (config.library && !args.includes("--library")) {
        args.push("--library", config.library);
      }
      return new StdioClientTransport({
        command: config.command ?? "python",
        args,
        env: config.env,
      });
    }
    return new SSEClientTransport(new URL(config.url));
  }

  /** Close the client and underlying transport. Idempotent. */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => {
        /* swallow — best-effort shutdown */
      });
      this.client = null;
    }
    if (this.transport) {
      await this.transport.close?.().catch(() => {});
      this.transport = null;
    }
  }

  /** Generic call. Prefer the typed methods below. */
  async callTool(name: string, args: Record<string, unknown>): Promise<L6ToolResult> {
    const client = await this.ensureConnected();
    const result = await client.callTool({ name, arguments: args });
    return result;
  }

  async queryAgentMemory(args: QueryAgentMemoryArgs): Promise<L6ToolResult> {
    return this.callTool("query_agent_memory", argsToRecord(args));
  }

  async listRecentWork(args: ListRecentWorkArgs = {}): Promise<L6ToolResult> {
    return this.callTool("list_recent_work", argsToRecord(args));
  }

  async findEntity(args: FindEntityArgs): Promise<L6ToolResult> {
    return this.callTool("find_entity", argsToRecord(args));
  }

  async getCrossAgentSummary(args: GetCrossAgentSummaryArgs): Promise<L6ToolResult> {
    return this.callTool("get_cross_agent_summary", argsToRecord(args));
  }

  async prepareRecognitionContext(args: RecognitionArgs): Promise<L6ToolResult> {
    return this.callTool("prepare_recognition_context", argsToRecord(args));
  }

  async getDeeperContext(args: RecognitionArgs): Promise<L6ToolResult> {
    return this.callTool("get_deeper_context", argsToRecord(args));
  }
}

/* -- internals --------------------------------------------------------- */

function argsToRecord(args: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
