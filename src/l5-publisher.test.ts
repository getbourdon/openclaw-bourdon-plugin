import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import yaml from "yaml";

import {
  buildOpenClawL5Manifest,
  type MemorySource,
  publishOpenClawL5,
  type RawEntity,
  type RawSession,
} from "./l5-publisher.js";
import { REDACTED_PLACEHOLDER } from "./redaction.js";

let tmpLibrary: string;

beforeEach(async () => {
  tmpLibrary = await fs.mkdtemp(path.join(os.tmpdir(), "bourdon-pub-test-"));
});

afterEach(async () => {
  await fs.rm(tmpLibrary, { recursive: true, force: true });
});

function fakeSource(opts: {
  entities?: RawEntity[];
  sessions?: RawSession[];
  instance?: string;
}): MemorySource {
  return {
    listEntities: async () => opts.entities ?? [],
    listSessions: async () => opts.sessions ?? [],
    instance: opts.instance ? () => opts.instance : undefined,
  };
}

describe("buildOpenClawL5Manifest", () => {
  it("produces a manifest with the required top-level fields", async () => {
    const m = await buildOpenClawL5Manifest(fakeSource({}));
    expect(m.spec_version).toBe("0.1");
    expect(m.agent.id).toBe("openclaw");
    expect(m.agent.type).toBe("local-swarm");
    expect(m.agent.role_narrative).toBeTruthy();
    expect(m.last_updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("forwards optional instance to agent.instance when source provides it", async () => {
    const m = await buildOpenClawL5Manifest(fakeSource({ instance: "mac-m1max" }));
    expect(m.agent.instance).toBe("mac-m1max");
  });

  it("filters out private-tagged entities (visibility guardrail)", async () => {
    const entities: RawEntity[] = [
      { name: "public-thing" },
      { name: "secret-thing", visibility: "private" },
      {
        name: "tagged-private",
        tags: ["personal-only"],
      },
    ];
    const m = await buildOpenClawL5Manifest(
      fakeSource({ entities }),
      { policy: { default: "team", private_tags: ["personal-only"] } },
    );
    const names = (m.known_entities ?? []).map((e) => e.name);
    expect(names).toContain("public-thing");
    expect(names).not.toContain("secret-thing");
    expect(names).not.toContain("tagged-private");
  });

  it("redacts credential-like text in entity summaries", async () => {
    const entities: RawEntity[] = [
      { name: "ent1", summary: "api_key=abc123 leaked" },
      { name: "ent2", summary: "harmless summary" },
    ];
    const m = await buildOpenClawL5Manifest(fakeSource({ entities }));
    const ent1 = m.known_entities?.find((e) => e.name === "ent1");
    const ent2 = m.known_entities?.find((e) => e.name === "ent2");
    expect(ent1?.summary).toBe(REDACTED_PLACEHOLDER);
    expect(ent2?.summary).toBe("harmless summary");
  });

  it("redacts credential-like text in session key_actions", async () => {
    const sessions: RawSession[] = [
      {
        date: "2026-05-09",
        key_actions: ["set api_token=abc", "ran tests"],
      },
    ];
    const m = await buildOpenClawL5Manifest(fakeSource({ sessions }));
    const actions = m.recent_sessions?.[0]?.key_actions ?? [];
    expect(actions).toContain(REDACTED_PLACEHOLDER);
    expect(actions).toContain("ran tests");
  });

  it("preserves temporal-validity fields on entities", async () => {
    const entities: RawEntity[] = [
      {
        name: "prun-v1.0.4",
        type: "release",
        valid_from: "2026-04-15",
        valid_to: "2026-04-23",
      },
    ];
    const m = await buildOpenClawL5Manifest(fakeSource({ entities }));
    expect(m.known_entities?.[0]).toMatchObject({
      name: "prun-v1.0.4",
      valid_from: "2026-04-15",
      valid_to: "2026-04-23",
    });
  });

  it("uses caller-provided agentId / agentType / roleNarrative when given", async () => {
    const m = await buildOpenClawL5Manifest(fakeSource({}), {
      agentId: "openclaw-test",
      agentType: "research-assistant",
      roleNarrative: "test override",
    });
    expect(m.agent.id).toBe("openclaw-test");
    expect(m.agent.type).toBe("research-assistant");
    expect(m.agent.role_narrative).toBe("test override");
  });
});

describe("publishOpenClawL5", () => {
  it("writes a parseable YAML manifest to the configured library", async () => {
    const result = await publishOpenClawL5(
      fakeSource({
        entities: [{ name: "PRUN", type: "project", tags: ["app"] }],
        sessions: [
          {
            date: "2026-05-09",
            project_focus: ["bourdon", "openclaw-plugin"],
            key_actions: ["wrote l5-publisher", "added tests"],
          },
        ],
      }),
      { library: tmpLibrary },
    );

    expect(result.path).toBe(
      path.join(tmpLibrary, "agents", "openclaw.l5.yaml"),
    );
    const onDisk = yaml.parse(await fs.readFile(result.path, "utf8")) as Record<
      string,
      unknown
    >;
    expect(onDisk["spec_version"]).toBe("0.1");
    expect(
      (onDisk["agent"] as Record<string, unknown>)["id"],
    ).toBe("openclaw");
    expect((onDisk["known_entities"] as unknown[]).length).toBe(1);
    expect((onDisk["recent_sessions"] as unknown[]).length).toBe(1);
  });

  it("writes a manifest that round-trips through readL5Dict", async () => {
    const result = await publishOpenClawL5(
      fakeSource({
        entities: [{ name: "Bourdon", type: "project" }],
      }),
      { library: tmpLibrary },
    );
    const { readL5Dict } = await import("./manifest-writer.js");
    const round = await readL5Dict(result.path);
    expect(round).not.toBeNull();
    expect((round as Record<string, unknown>)["spec_version"]).toBe("0.1");
  });

  it("does not leak the .tmp file (atomicity check)", async () => {
    const result = await publishOpenClawL5(fakeSource({}), {
      library: tmpLibrary,
    });
    await expect(fs.access(`${result.path}.tmp`)).rejects.toThrow();
  });
});
