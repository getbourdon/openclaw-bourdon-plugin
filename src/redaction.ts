/**
 * Credential redaction — TypeScript port of
 * bourdon/adapters/codex.py:212-254 (_NATIVE_MEMORY_SENSITIVE_PATTERNS +
 * _safe_native_memory_text).
 *
 * Run every string that originated from native OpenClaw memory state through
 * `safeNativeMemoryText` before it lands in an L5 field. Same pattern set as
 * the codex adapter for consistency across the federation.
 *
 * If OpenClaw introduces vendor-specific token prefixes that aren't covered
 * here, extend NATIVE_MEMORY_SENSITIVE_PATTERNS in a wrapper module — do NOT
 * fork this helper.
 */

export const NATIVE_MEMORY_SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\bapi[_-]?key\b/i,
  /\bapi[_-]?token\b/i,
  /\baccess[_-]?token\b/i,
  /\bbearer\s+token\b/i,
  /\bpassword\b/i,
  /\bsk_live_[A-Za-z0-9_]+\b/,
  /\bhf_[A-Za-z0-9_]{10,}\b/i,
];

export const REDACTED_PLACEHOLDER = "[redacted credential-like text]";
export const URL_PLACEHOLDER = "[link]";

/** Default snippet character cap, matching bourdon/adapters/codex.py. */
export const DEFAULT_SNIPPET_CHAR_LIMIT = 180;

/** Collapse runs of whitespace to single spaces and trim. */
export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Redact credentials from native-memory text and cap length.
 *
 * Mirrors bourdon/adapters/codex.py::_safe_native_memory_text():
 * - if any sensitive pattern matches, return the redacted placeholder verbatim
 * - replace any URL with [link]
 * - truncate to `limit` chars, ending with "..."
 */
export function safeNativeMemoryText(
  value: string,
  limit: number = DEFAULT_SNIPPET_CHAR_LIMIT,
  patterns: readonly RegExp[] = NATIVE_MEMORY_SENSITIVE_PATTERNS,
): string {
  let text = normalizeText(value);

  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return REDACTED_PLACEHOLDER;
    }
  }

  text = text.replace(/https?:\/\/\S+/g, URL_PLACEHOLDER);

  if (text.length <= limit) {
    return text;
  }
  return text.slice(0, Math.max(0, limit - 3)).trimEnd() + "...";
}

/**
 * Convenience wrapper that lets callers extend the credential-pattern set
 * with agent-specific prefixes (e.g., a vendor-specific token format) without
 * forking the function.
 */
export function makeSafeRedactor(
  extraPatterns: readonly RegExp[] = [],
  limit: number = DEFAULT_SNIPPET_CHAR_LIMIT,
): (value: string) => string {
  const patterns = [...NATIVE_MEMORY_SENSITIVE_PATTERNS, ...extraPatterns];
  return (value: string) => safeNativeMemoryText(value, limit, patterns);
}
