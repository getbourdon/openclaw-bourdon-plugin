/**
 * Bourdon L5 manifest types — TypeScript port of bourdon/adapters/base.py.
 *
 * The wire format (the YAML written to ~/agent-library/agents/<id>.l5.yaml)
 * must validate against bourdon/spec/L5_schema.json. These interfaces are the
 * compile-time mirror so the publisher emits manifests that load cleanly via
 * Bourdon's L6Store.
 */

export const CONTRACT_VERSION = "0.1";
export const SPEC_VERSION = "0.1";

export type Visibility = "public" | "team" | "private";

export interface AgentInfo {
  /** Unique slug for this agent. Used as the L6 filename and cross-agent reference key. */
  id: string;
  /** Agent category. Informs L6 query routing and UI grouping. */
  type:
    | "code-assistant"
    | "note-capture"
    | "local-swarm"
    | "customer-support"
    | "research-assistant"
    | "creative-collaborator"
    | "project-manager"
    | "tutor"
    | "other";
  /** Optional machine/deployment identifier. */
  instance?: string;
  /** Version range of Bourdon specs this manifest is compatible with. */
  spec_version_compat?: string;
  /** Optional narrative disambiguating agents that share the same `type` slug. */
  role_narrative?: string;
}

export interface Entity {
  name: string;
  type?: string;
  aliases?: string[];
  summary?: string;
  /** ISO 8601 timestamp of when this entity was last touched. */
  last_touched?: string;
  tags?: string[];
  visibility?: Visibility;
  /** ISO 8601 date (YYYY-MM-DD). */
  valid_from?: string;
  /** ISO 8601 date. None = active as of last_updated. */
  valid_to?: string;
}

export interface Session {
  /** ISO 8601 date or datetime. */
  date: string;
  cwd?: string;
  project_focus?: string[];
  key_actions?: string[];
  files_touched?: string[];
  visibility?: Visibility;
}

export interface VisibilityPolicy {
  default?: Visibility;
  private_tags?: string[];
  team_tags?: string[];
}

export interface L5Manifest {
  spec_version: string;
  agent: AgentInfo;
  /** ISO 8601 UTC timestamp. */
  last_updated: string;
  capabilities?: string[];
  recent_sessions?: Session[];
  known_entities?: Entity[];
  visibility_policy?: VisibilityPolicy;
}

/**
 * Resolve an entity's effective visibility. Mirrors
 * bourdon/adapters/base.py::apply_visibility().
 *
 * Precedence (highest first):
 *   1. private_tags match → "private" (cannot be overridden — PII guardrail)
 *   2. entity.visibility set explicitly
 *   3. team_tags match → "team"
 *   4. policy.default (or "public" if no policy)
 */
export function applyVisibility(
  entity: Entity,
  policy?: VisibilityPolicy,
): Visibility {
  const tags = new Set(entity.tags ?? []);
  const privateTags = policy?.private_tags ?? [];
  const teamTags = policy?.team_tags ?? [];

  for (const t of privateTags) {
    if (tags.has(t)) return "private";
  }

  if (entity.visibility !== undefined) {
    return entity.visibility;
  }

  for (const t of teamTags) {
    if (tags.has(t)) return "team";
  }

  return policy?.default ?? "public";
}

/** Filter for federation: drop any entity whose effective visibility is "private". */
export function filterForFederation(
  entities: Entity[],
  policy?: VisibilityPolicy,
): Entity[] {
  return entities.filter((e) => applyVisibility(e, policy) !== "private");
}
