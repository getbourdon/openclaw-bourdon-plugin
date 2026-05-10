import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import yaml from "yaml";

import {
  defaultL5Path,
  readL5Dict,
  visibilityAllowedForAccessLevel,
  writeL5,
  writeL5Dict,
} from "./manifest-writer.js";
import type { L5Manifest } from "./types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bourdon-openclaw-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("writeL5Dict", () => {
  it("writes valid YAML to the target path", async () => {
    const target = path.join(tmpDir, "agents", "test.l5.yaml");
    const manifest = {
      spec_version: "0.1",
      agent: { id: "test", type: "code-assistant" },
      last_updated: "2026-05-09T00:00:00Z",
    };
    await writeL5Dict(manifest, target);
    const written = await fs.readFile(target, "utf8");
    expect(yaml.parse(written)).toEqual(manifest);
  });

  it("creates parent directories if missing", async () => {
    const target = path.join(tmpDir, "deep", "nested", "path", "file.l5.yaml");
    await writeL5Dict({ spec_version: "0.1" }, target);
    const stat = await fs.stat(target);
    expect(stat.isFile()).toBe(true);
  });

  it("does not leave the .tmp file behind on success", async () => {
    const target = path.join(tmpDir, "ok.l5.yaml");
    await writeL5Dict({ spec_version: "0.1" }, target);
    await expect(fs.access(`${target}.tmp`)).rejects.toThrow();
  });

  it("overwrites existing files atomically", async () => {
    const target = path.join(tmpDir, "agent.l5.yaml");
    await writeL5Dict({ spec_version: "0.1", v: 1 }, target);
    await writeL5Dict({ spec_version: "0.1", v: 2 }, target);
    const final = yaml.parse(await fs.readFile(target, "utf8"));
    expect(final).toEqual({ spec_version: "0.1", v: 2 });
    await expect(fs.access(`${target}.tmp`)).rejects.toThrow();
  });
});

describe("writeL5", () => {
  it("strips undefined fields and empty arrays from the output", async () => {
    const target = path.join(tmpDir, "clean.l5.yaml");
    const manifest: L5Manifest = {
      spec_version: "0.1",
      agent: {
        id: "openclaw",
        type: "local-swarm",
        instance: undefined, // should be dropped
      },
      last_updated: "2026-05-09T00:00:00Z",
      capabilities: [], // empty array -> dropped
      known_entities: [
        {
          name: "test-entity",
          tags: [], // empty -> dropped
          aliases: ["t"],
        },
      ],
    };
    await writeL5(manifest, target);
    const round = yaml.parse(await fs.readFile(target, "utf8"));
    expect(round).toEqual({
      spec_version: "0.1",
      agent: { id: "openclaw", type: "local-swarm" },
      last_updated: "2026-05-09T00:00:00Z",
      known_entities: [
        {
          name: "test-entity",
          aliases: ["t"],
        },
      ],
    });
  });
});

describe("readL5Dict", () => {
  it("reads back what writeL5Dict wrote", async () => {
    const target = path.join(tmpDir, "round.l5.yaml");
    const manifest = {
      spec_version: "0.1",
      agent: { id: "x", type: "tutor" },
      last_updated: "2026-05-09T00:00:00Z",
    };
    await writeL5Dict(manifest, target);
    expect(await readL5Dict(target)).toEqual(manifest);
  });

  it("returns null on missing file", async () => {
    expect(await readL5Dict(path.join(tmpDir, "missing.yaml"))).toBeNull();
  });

  it("returns null on invalid YAML", async () => {
    const bad = path.join(tmpDir, "bad.yaml");
    await fs.writeFile(bad, "{ not: valid yaml: oops:::");
    expect(await readL5Dict(bad)).toBeNull();
  });

  it("returns null on non-object root", async () => {
    const list = path.join(tmpDir, "list.yaml");
    await fs.writeFile(list, "- one\n- two\n");
    expect(await readL5Dict(list)).toBeNull();
  });
});

describe("defaultL5Path", () => {
  it("composes path under HOME/agent-library/agents", () => {
    const original = process.env["HOME"];
    process.env["HOME"] = "/tmp/fake-home";
    try {
      expect(defaultL5Path("openclaw")).toBe(
        "/tmp/fake-home/agent-library/agents/openclaw.l5.yaml",
      );
    } finally {
      if (original !== undefined) process.env["HOME"] = original;
      else delete process.env["HOME"];
    }
  });

  it("honors a caller-provided library override", () => {
    expect(defaultL5Path("foo", "/srv/library")).toBe(
      "/srv/library/agents/foo.l5.yaml",
    );
  });
});

describe("visibilityAllowedForAccessLevel", () => {
  it("public access allows only public", () => {
    expect(visibilityAllowedForAccessLevel("public", "public")).toBe(true);
    expect(visibilityAllowedForAccessLevel("team", "public")).toBe(false);
    expect(visibilityAllowedForAccessLevel("private", "public")).toBe(false);
    expect(visibilityAllowedForAccessLevel(undefined, "public")).toBe(true);
  });

  it("team access allows public + team", () => {
    expect(visibilityAllowedForAccessLevel("public", "team")).toBe(true);
    expect(visibilityAllowedForAccessLevel("team", "team")).toBe(true);
    expect(visibilityAllowedForAccessLevel("private", "team")).toBe(false);
  });

  it("private access allows everything", () => {
    expect(visibilityAllowedForAccessLevel("public", "private")).toBe(true);
    expect(visibilityAllowedForAccessLevel("team", "private")).toBe(true);
    expect(visibilityAllowedForAccessLevel("private", "private")).toBe(true);
  });
});
