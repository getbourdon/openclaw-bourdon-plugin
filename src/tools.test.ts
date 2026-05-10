import { describe, expect, it, vi } from "vitest";

import type { BourdonL6Client } from "./l6-client.js";
import { makeBourdonTools } from "./tools.js";

function fakeClient(): BourdonL6Client {
  return {
    queryAgentMemory: vi.fn().mockResolvedValue({ ok: true, tool: "search" }),
    listRecentWork: vi.fn().mockResolvedValue({ ok: true, tool: "recent" }),
    findEntity: vi.fn().mockResolvedValue({ ok: true, tool: "entity" }),
    getCrossAgentSummary: vi.fn().mockResolvedValue({ ok: true, tool: "summary" }),
    prepareRecognitionContext: vi
      .fn()
      .mockResolvedValue({ ok: true, tool: "recognize" }),
    getDeeperContext: vi.fn().mockResolvedValue({ ok: true, tool: "deeper" }),
    callTool: vi.fn(),
    close: vi.fn(),
  } as unknown as BourdonL6Client;
}

describe("makeBourdonTools", () => {
  it("returns exactly six tools with the canonical names", () => {
    const tools = makeBourdonTools(fakeClient());
    expect(tools.map((t) => t.name)).toEqual([
      "bourdon_search",
      "bourdon_cross_agent_summary",
      "bourdon_recent_work",
      "bourdon_find_entity",
      "bourdon_recognize",
      "bourdon_deeper_context",
    ]);
  });

  it("every tool declares an object inputSchema with additionalProperties=false", () => {
    const tools = makeBourdonTools(fakeClient());
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(Object.keys(t.inputSchema.properties).length).toBeGreaterThan(0);
    }
  });

  it("every tool exposes access_level and include_private", () => {
    const tools = makeBourdonTools(fakeClient());
    for (const t of tools) {
      expect(t.inputSchema.properties).toHaveProperty("access_level");
      expect(t.inputSchema.properties).toHaveProperty("include_private");
    }
  });

  it("required-arg tools mark their non-optional fields as required", () => {
    const tools = makeBourdonTools(fakeClient());
    const byName = Object.fromEntries(tools.map((t) => [t.name, t] as const));
    expect(byName["bourdon_search"]?.inputSchema.required).toEqual([
      "agent",
      "topic",
    ]);
    expect(byName["bourdon_cross_agent_summary"]?.inputSchema.required).toEqual([
      "project",
    ]);
    expect(byName["bourdon_find_entity"]?.inputSchema.required).toEqual(["name"]);
    expect(byName["bourdon_recognize"]?.inputSchema.required).toEqual(["prompt"]);
    expect(byName["bourdon_deeper_context"]?.inputSchema.required).toEqual([
      "prompt",
    ]);
  });

  it("bourdon_recent_work has empty required array (everything optional)", () => {
    const tools = makeBourdonTools(fakeClient());
    const recent = tools.find((t) => t.name === "bourdon_recent_work");
    expect(recent?.inputSchema.required).toEqual([]);
  });

  it("each handler routes to the matching L6 client method", async () => {
    const client = fakeClient();
    const tools = makeBourdonTools(client);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t] as const));

    await byName["bourdon_search"]?.handler({
      agent: "codex",
      topic: "bourdon",
    });
    await byName["bourdon_cross_agent_summary"]?.handler({ project: "PRUN" });
    await byName["bourdon_recent_work"]?.handler({});
    await byName["bourdon_find_entity"]?.handler({ name: "PRUN" });
    await byName["bourdon_recognize"]?.handler({ prompt: "what is bourdon" });
    await byName["bourdon_deeper_context"]?.handler({ prompt: "tell me more" });

    expect(client.queryAgentMemory).toHaveBeenCalledTimes(1);
    expect(client.getCrossAgentSummary).toHaveBeenCalledTimes(1);
    expect(client.listRecentWork).toHaveBeenCalledTimes(1);
    expect(client.findEntity).toHaveBeenCalledTimes(1);
    expect(client.prepareRecognitionContext).toHaveBeenCalledTimes(1);
    expect(client.getDeeperContext).toHaveBeenCalledTimes(1);
  });

  it("applies the default access_level when caller doesn't specify one", async () => {
    const client = fakeClient();
    const tools = makeBourdonTools(client, { defaultAccessLevel: "private" });
    const search = tools.find((t) => t.name === "bourdon_search")!;
    await search.handler({ agent: "codex", topic: "bourdon" });
    expect(client.queryAgentMemory).toHaveBeenCalledWith(
      expect.objectContaining({ access_level: "private" }),
    );
  });

  it("respects caller-provided access_level over the default", async () => {
    const client = fakeClient();
    const tools = makeBourdonTools(client, { defaultAccessLevel: "team" });
    const search = tools.find((t) => t.name === "bourdon_search")!;
    await search.handler({
      agent: "codex",
      topic: "bourdon",
      access_level: "public",
    });
    expect(client.queryAgentMemory).toHaveBeenCalledWith(
      expect.objectContaining({ access_level: "public" }),
    );
  });
});
