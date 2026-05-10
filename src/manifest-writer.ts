/**
 * Atomic L5 manifest write — TypeScript port of bourdon/core/l5_io.py
 * (write_l5, write_l5_dict, read_l5_dict).
 *
 * Writes via tmp file + fsync + atomic rename so concurrent readers (e.g.,
 * the L6Store file watcher) never observe a half-written manifest. Same
 * tmp+fsync+rename pattern Bourdon's Python helper uses on POSIX/NTFS.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

import yaml from "yaml";

import type { L5Manifest, Visibility } from "./types.js";

/**
 * Atomically write a manifest dict to `targetPath`. Creates parent directories
 * if missing.
 *
 * Mirrors bourdon/core/l5_io.py::write_l5_dict — write to <path>.tmp, fsync,
 * rename into place. The rename is atomic on the same filesystem.
 */
export async function writeL5Dict(
  manifest: Record<string, unknown>,
  targetPath: string,
): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });

  const tmpPath = `${targetPath}.tmp`;
  const yamlText = yaml.stringify(manifest, {
    sortMapEntries: false,
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN",
  });

  let fileHandle: fs.FileHandle | undefined;
  try {
    fileHandle = await fs.open(tmpPath, "w");
    await fileHandle.writeFile(yamlText, "utf8");
    await fileHandle.sync();
  } catch (err) {
    await fileHandle?.close();
    await safeUnlink(tmpPath);
    throw err;
  } finally {
    await fileHandle?.close();
  }

  try {
    await fs.rename(tmpPath, targetPath);
  } catch (err) {
    await safeUnlink(tmpPath);
    throw err;
  }
}

/** Atomically write an L5Manifest object. Strips undefined and empty-array fields. */
export async function writeL5(
  manifest: L5Manifest,
  targetPath: string,
): Promise<void> {
  const cleaned = pruneEmpty(manifest) as Record<string, unknown>;
  await writeL5Dict(cleaned, targetPath);
}

/**
 * Read an L5 manifest from disk. Returns null on any failure (missing file,
 * parse error, non-object content). Intentionally lenient — mirrors
 * read_l5_dict in bourdon/core/l5_io.py.
 */
export async function readL5Dict(
  sourcePath: string,
): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await fs.readFile(sourcePath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = yaml.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

/** Default L5 manifest path: $HOME/agent-library/agents/<agentId>.l5.yaml. */
export function defaultL5Path(agentId: string, library?: string): string {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? ".";
  const libraryPath = library ?? path.join(home, "agent-library");
  return path.join(libraryPath, "agents", `${agentId}.l5.yaml`);
}

/** Effective access level for visibility filtering at the manifest boundary. */
export function visibilityAllowedForAccessLevel(
  visibility: Visibility | undefined,
  accessLevel: Visibility,
): boolean {
  // Public: only public entities
  // Team:   public + team
  // Private: public + team + private
  const v = visibility ?? "public";
  if (accessLevel === "public") return v === "public";
  if (accessLevel === "team") return v === "public" || v === "team";
  return true;
}

/* -- internals --------------------------------------------------------- */

async function safeUnlink(p: string): Promise<void> {
  try {
    await fs.unlink(p);
  } catch {
    // best-effort cleanup
  }
}

/**
 * Recursively drop undefined values, empty arrays, and empty plain objects so
 * the YAML output stays clean — mirrors L5Manifest.to_dict() in
 * bourdon/adapters/base.py.
 */
function pruneEmpty(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const arr = value
      .map(pruneEmpty)
      .filter((v): v is unknown => v !== undefined);
    return arr.length === 0 ? undefined : arr;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let kept = false;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const pruned = pruneEmpty(v);
      if (pruned !== undefined) {
        out[k] = pruned;
        kept = true;
      }
    }
    return kept ? out : undefined;
  }
  return value;
}
