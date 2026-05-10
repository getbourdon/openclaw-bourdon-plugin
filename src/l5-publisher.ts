/**
 * L5 manifest publisher.
 *
 * Reads OpenClaw memory state (via an injected MemorySource interface — see
 * index.ts for the wiring against `openclaw/plugin-sdk/*`) and produces a
 * Bourdon L5 manifest that gets written atomically to
 * ~/agent-library/agents/openclaw.l5.yaml.
 *
 * The MemorySource abstraction lets us unit-test the publisher with fixture
 * data and lets the real SDK coupling live in index.ts. If OpenClaw's memory
 * model evolves, the index.ts wiring is the only thing that needs updating —
 * the publisher itself stays stable.
 */

import { defaultL5Path, writeL5 } from "./manifest-writer.js";
import { safeNativeMemoryText } from "./redaction.js";
import {
  type AgentInfo,
  type Entity,
  type L5Manifest,
  type Session,
  SPEC_VERSION,
  type Visibility,
  type VisibilityPolicy,
  filterForFederation,
} from "./types.js";

/** What the publisher needs to know about OpenClaw's memory state. */
export interface MemorySource {
  listEntities(): Promise<RawEntity[]>;
  listSessions(): Promise<RawSession[]>;
  /** Optional: instance identifier (e.g., machine name) for the agent block. */
  instance?(): string | undefined;
}

/** Raw entity returned by OpenClaw's memory store, before normalization. */
export interface RawEntity {
  name: string;
  type?: string;
  aliases?: string[];
  /** Free-text summary as stored natively. Will be redacted before emit. */
  summary?: string;
  /** ISO 8601 timestamp of last touch. */
  last_touched?: string;
  tags?: string[];
  visibility?: Visibility;
  valid_from?: string;
  valid_to?: string;
}

/** Raw session row from OpenClaw's session log. */
export interface RawSession {
  /** ISO 8601 date or datetime. */
  date: string;
  cwd?: string;
  /** Free-text key-actions list as stored natively. Will be redacted item-by-item. */
  key_actions?: string[];
  files_touched?: string[];
  project_focus?: string[];
  visibility?: Visibility;
}

export interface PublisherOptions {
  /** Override the agent.id (default: "openclaw"). */
  agentId?: string;
  /** Override the agent.type (default: "local-swarm"). */
  agentType?: AgentInfo["type"];
  /** Optional role narrative — see bourdon-adapter-authoring skill. */
  roleNarrative?: string;
  /** Library override (default: $HOME/agent-library). */
  library?: string;
  /** Visibility policy applied during federation filtering. */
  policy?: VisibilityPolicy;
  /** Snippet character cap forwarded to the redactor. */
  snippetCharLimit?: number;
}

const DEFAULT_AGENT_ID = "openclaw";
const DEFAULT_AGENT_TYPE: AgentInfo["type"] = "local-swarm";
const DEFAULT_ROLE_NARRATIVE =
  "Personal AI assistant platform. OpenClaw orchestrates per-user " +
  "channels and skills (clawhub plugins) across surfaces — chat, " +
  "voice, mobile. Integrates back into Bourdon's federation so other " +
  "agents recall what OpenClaw has been doing on the user's behalf.";

/** Build a normalized L5 manifest from a memory source. Does not write to disk. */
export async function buildOpenClawL5Manifest(
  source: MemorySource,
  options: PublisherOptions = {},
): Promise<L5Manifest> {
  const [rawEntities, rawSessions] = await Promise.all([
    source.listEntities(),
    source.listSessions(),
  ]);

  const limit = options.snippetCharLimit;
  const entities: Entity[] = rawEntities.map((raw) =>
    normalizeEntity(raw, limit),
  );
  const sessions: Session[] = rawSessions.map((raw) =>
    normalizeSession(raw, limit),
  );

  // Apply visibility filtering before federation. L6 trusts what we emit.
  const visibleEntities = filterForFederation(entities, options.policy);

  const agent: AgentInfo = {
    id: options.agentId ?? DEFAULT_AGENT_ID,
    type: options.agentType ?? DEFAULT_AGENT_TYPE,
    role_narrative: options.roleNarrative ?? DEFAULT_ROLE_NARRATIVE,
  };
  const instance = source.instance?.();
  if (instance) agent.instance = instance;

  return {
    spec_version: SPEC_VERSION,
    agent,
    last_updated: new Date().toISOString(),
    recent_sessions: sessions,
    known_entities: visibleEntities,
    visibility_policy: options.policy,
  };
}

/** Build + atomically write the L5 manifest. Returns the resolved target path. */
export async function publishOpenClawL5(
  source: MemorySource,
  options: PublisherOptions = {},
): Promise<{ manifest: L5Manifest; path: string }> {
  const manifest = await buildOpenClawL5Manifest(source, options);
  const targetPath = defaultL5Path(manifest.agent.id, options.library);
  await writeL5(manifest, targetPath);
  return { manifest, path: targetPath };
}

/* -- internals --------------------------------------------------------- */

function normalizeEntity(raw: RawEntity, limit?: number): Entity {
  const out: Entity = { name: raw.name };
  if (raw.type) out.type = raw.type;
  if (raw.aliases?.length) out.aliases = raw.aliases.map((a) => a.trim()).filter(Boolean);
  if (raw.summary) out.summary = safeNativeMemoryText(raw.summary, limit);
  if (raw.last_touched) out.last_touched = raw.last_touched;
  if (raw.tags?.length) out.tags = raw.tags;
  if (raw.visibility) out.visibility = raw.visibility;
  if (raw.valid_from) out.valid_from = raw.valid_from;
  if (raw.valid_to) out.valid_to = raw.valid_to;
  return out;
}

function normalizeSession(raw: RawSession, limit?: number): Session {
  const out: Session = { date: raw.date };
  if (raw.cwd) out.cwd = raw.cwd;
  if (raw.project_focus?.length) {
    out.project_focus = raw.project_focus
      .map((p) => safeNativeMemoryText(p, limit))
      .filter(Boolean);
  }
  if (raw.key_actions?.length) {
    out.key_actions = raw.key_actions
      .map((a) => safeNativeMemoryText(a, limit))
      .filter(Boolean);
  }
  if (raw.files_touched?.length) {
    out.files_touched = raw.files_touched.map((f) => safeNativeMemoryText(f, limit));
  }
  if (raw.visibility) out.visibility = raw.visibility;
  return out;
}
