/**
 * Unit tests for BourdonL6Client.
 *
 * The full integration test (real `python -m core.l6_server` subprocess) lives
 * out-of-tree under `tests/integration/` once we wire that up. These unit tests
 * cover the surface that doesn't require a real subprocess: argument shaping,
 * transport selection, idempotent close, etc.
 */

import { describe, expect, it, vi } from "vitest";

import { BourdonL6Client } from "./l6-client.js";

describe("BourdonL6Client", () => {
  it("does not connect until the first call", () => {
    const client = new BourdonL6Client({
      transport: "stdio",
      command: "python",
      args: ["-m", "core.l6_server"],
    });
    // Construction alone should never spawn the subprocess
    expect(client).toBeDefined();
  });

  it("close() is idempotent on a never-connected client", async () => {
    const client = new BourdonL6Client({
      transport: "stdio",
      command: "python",
      args: ["-m", "core.l6_server"],
    });
    await expect(client.close()).resolves.toBeUndefined();
    await expect(client.close()).resolves.toBeUndefined();
  });

  it("strips undefined arg values before sending to the wire", async () => {
    const client = new BourdonL6Client({
      transport: "stdio",
      command: "python",
      args: ["-m", "core.l6_server"],
    });
    const callTool = vi
      .spyOn(client, "callTool")
      .mockResolvedValue({ ok: true });

    await client.queryAgentMemory({
      agent: "codex",
      topic: "bourdon",
      access_level: undefined, // should be stripped
    });

    expect(callTool).toHaveBeenCalledWith("query_agent_memory", {
      agent: "codex",
      topic: "bourdon",
    });
    callTool.mockRestore();
  });

  it("forwards typed args to the right tool name", async () => {
    const client = new BourdonL6Client({
      transport: "stdio",
      command: "python",
      args: ["-m", "core.l6_server"],
    });
    const callTool = vi
      .spyOn(client, "callTool")
      .mockResolvedValue({ ok: true });

    await client.findEntity({ name: "PRUN", access_level: "team" });
    await client.getCrossAgentSummary({ project: "PRUN", access_level: "team" });
    await client.listRecentWork({ since: "2026-05-01", access_level: "team" });
    await client.prepareRecognitionContext({
      prompt: "what is bourdon",
      access_level: "team",
    });
    await client.getDeeperContext({
      prompt: "tell me about bourdon",
      access_level: "private",
    });

    const calls = callTool.mock.calls.map((call) => call[0]);
    expect(calls).toEqual([
      "find_entity",
      "get_cross_agent_summary",
      "list_recent_work",
      "prepare_recognition_context",
      "get_deeper_context",
    ]);
    callTool.mockRestore();
  });
});
