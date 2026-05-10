# Security model — `@bourdon/openclaw`

## What this plugin does at runtime

`@bourdon/openclaw` is an OpenClaw plugin (`kind: memory`) that bridges OpenClaw to Bourdon's L6 cross-agent memory federation server. After installation, on first tool call it:

1. Reads its `pluginConfig` from OpenClaw's config (no implicit defaults beyond what's documented in `openclaw.plugin.json` `configSchema`).
2. **Spawns a child process** (by default: `python -m core.l6_server`) and communicates with it over stdin/stdout using the [Model Context Protocol](https://modelcontextprotocol.io/) via the official `@modelcontextprotocol/sdk` client.
3. Proxies six named tool calls (`bourdon_search`, `bourdon_cross_agent_summary`, `bourdon_recent_work`, `bourdon_find_entity`, `bourdon_recognize`, `bourdon_deeper_context`) to the spawned subprocess and returns its responses to the OpenClaw agent.
4. Optionally (when called via the L5 publisher path, not from the OpenClaw runtime) reads `~/.openclaw` session/memory state and writes a normalized YAML manifest to `~/agent-library/agents/openclaw.l5.yaml` for cross-agent federation.

## Why this triggers static-analysis flags

Automated package scanners (including ClawHub's) flag the combination of "executes code" and "spawns external subprocess with configurable command/args" as **suspicious** by default. This is correct behavior — that pattern *is* what malware looks like. The flag is not specific to this plugin; any MCP client that connects via `stdio` transport will trigger it.

## What stops this from being unsafe

1. **The spawned process is configurable, not silent.** The `command` (default `python`) and `args` (default `["-m", "core.l6_server"]`) are declared in `openclaw.plugin.json` `configSchema.l6.command` and `configSchema.l6.args`. A user can inspect them before enabling the plugin, set them in config, or block them entirely.
2. **The subprocess is `core.l6_server` from the published `bourdon` PyPI package** ([source](https://github.com/getbourdon/bourdon/blob/main/core/l6_server.py)). Same author, same BSL 1.1 license, same release cadence. Installing this plugin without `pip install bourdon` already in the environment is a no-op — the spawn fails on first call and the L6 client returns a connection error.
3. **The L6 server is read-mostly.** It reads `~/agent-library/agents/*.l5.yaml` and answers queries. The only write path is the L5 *publisher* path (a separate code path from the tool proxies) which writes `openclaw.l5.yaml` — the agent's own memory file.
4. **Credential redaction is applied on every string the L6 server returns.** The patterns are imported directly from Bourdon's Python adapter (`adapters/codex.py::_NATIVE_MEMORY_SENSITIVE_PATTERNS`), ported to TypeScript in `src/redaction.ts`. `api[_-]?key`, `api[_-]?token`, `access[_-]?token`, `bearer\s+token`, `password`, `sk_live_*` (Stripe), `hf_*` (HuggingFace) match → replaced with `[redacted credential-like text]`.
5. **Atomic L5 writes.** The publisher uses tmp + fsync + rename so concurrent readers never observe a half-written manifest. Implementation in `src/manifest-writer.ts` mirrors Bourdon's `core/l5_io.py`.
6. **No network calls from the plugin itself.** All network behavior (HTTP/SSE transport for L6) is opt-in via `pluginConfig.l6.transport = "http"`, not the default.
7. **No filesystem access outside `$HOME/agent-library/` and the user-configured library path.** The publisher writes only to `$HOME/agent-library/agents/<id>.l5.yaml`; no other paths are touched at write time.

## Test coverage

44 unit tests, all green (`pnpm test`). Cover the four mandatory adapter test categories from Bourdon's spec (discovery, schema conformance, visibility filtering, round-trip via L6Store) plus credential redaction.

## Reporting

If you find a security issue, please email **licensing@bourdon.ai** (RADLAB LLC) or open a private security advisory on the [Bourdon repository](https://github.com/getbourdon/bourdon/security/advisories). Do not file public issues for security reports.
