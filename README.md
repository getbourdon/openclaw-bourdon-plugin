# @bourdon/openclaw

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-blue.svg)](LICENSE)

[Bourdon](https://bourdon.ai) plugin for [OpenClaw](https://openclaw.ai) — cross-agent memory federation native to your OpenClaw agents.

## What it does

After installing this plugin, your OpenClaw agents:

1. **Publish** an `openclaw.l5.yaml` manifest to `~/agent-library/agents/` after every session, so other Bourdon-equipped agents (Claude Code, Codex, Cursor) can recall what OpenClaw did.
2. **Recall** what other agents have been doing via six new tools:

| Tool | Description |
|---|---|
| `bourdon_search` | Search a specific agent's L5 manifest for entities and recent work matching a topic. |
| `bourdon_cross_agent_summary` | Summarize a project's state across every agent that's worked on it. |
| `bourdon_recent_work` | List recent sessions across all agents (or filtered to one) since a date. |
| `bourdon_find_entity` | Look up an entity (project, file, concept) across agents and return everywhere it's been touched. |
| `bourdon_recognize` | Format a Bourdon recognition payload for a given prompt — the recognition-first runtime hook. |
| `bourdon_deeper_context` | Pull deeper episodic context for a prompt when the agent has the response time. |

Plus the `agent-library://` MCP resources for direct manifest browsing.

## Why

The Bourdon thesis: cross-agent memory federation works when *every* agent has a Bourdon layer. OpenClaw is a 370k-star personal AI assistant platform with a real plugin SDK, daily-cadence releases, and a culture of `AGENTS.md` adoption. Wiring Bourdon into OpenClaw means OpenClaw users get cross-agent recall against the rest of their tooling without leaving the assistant.

## Installation

### Via clawhub (recommended)

```sh
openclaw plugin install bourdon
```

### Manual

```sh
pnpm add -D @bourdon/openclaw
```

Then add to your OpenClaw config (`~/.openclaw/config.json` or whatever your installation uses):

```json
{
  "plugins": {
    "entries": {
      "bourdon": {
        "enabled": true
      }
    }
  }
}
```

## Prerequisites

- **Bourdon installed in a reachable Python environment.** The plugin spawns `python -m core.l6_server` to query Bourdon's L6 federation server. `pip install bourdon` (currently 0.3.0) on the same host where OpenClaw runs.
- **At least one L5 manifest under `~/agent-library/agents/`.** The fastest way to seed: enable Bourdon's Claude Code SessionEnd hook and end one Claude Code session. After that, you have something to recall.

## Configuration

Default config (everything optional):

```json
{
  "library": "~/agent-library",
  "publishOnSessionEnd": true,
  "accessLevel": "team",
  "l6": {
    "transport": "stdio",
    "command": "python",
    "args": ["-m", "core.l6_server"],
    "spawnTimeoutMs": 5000
  },
  "redaction": {
    "snippetCharLimit": 180
  }
}
```

For users who want L6 as a long-running HTTP service rather than a per-call stdio subprocess:

```json
{
  "l6": {
    "transport": "http",
    "url": "http://localhost:7500/sse"
  }
}
```

Then start L6 separately:

```sh
python -m core.l6_server --transport http --port 7500 --library ~/agent-library
```

## Visibility model

The plugin defaults to `accessLevel: "team"`. Entities tagged `private` in their source L5 manifest are filtered at the L6 layer and never reach the OpenClaw agent. Override per-call by passing `access_level` to any `bourdon_*` tool.

To prevent OpenClaw from seeing certain agents' memory entirely, scope the `library` setting to a directory that only contains the manifests you want to expose.

## Development

```sh
pnpm install
pnpm test
pnpm build
```

This is a community plugin built against OpenClaw's published `openclaw/plugin-sdk/*` subpath exports — no monorepo clone required. If you're contributing back to OpenClaw's `extensions/bourdon/` directly, the source files port over cleanly with a workspace-deps adjustment.

## Related

- **Bourdon project:** [bourdon.ai](https://bourdon.ai) · [getbourdon/bourdon](https://github.com/getbourdon/bourdon)
- **OpenClaw project:** [openclaw.ai](https://openclaw.ai) · [openclaw/openclaw](https://github.com/openclaw/openclaw)
- **Bourdon adapter authoring guide:** [`bourdon/docs/AUTHORING_AN_ADAPTER.md`](https://github.com/getbourdon/bourdon/blob/main/docs/AUTHORING_AN_ADAPTER.md)
- **MCP specification:** [modelcontextprotocol.io](https://modelcontextprotocol.io/)

## License

[Business Source License 1.1](LICENSE) — auto-converts to Apache 2.0 four years after the version's publication. Same license as Bourdon itself. Free for solo, internal, research, and non-competing commercial use. Commercial license needed only for hosted-service offerings or paid-product embedding that competes with RADLAB LLC's paid version of Bourdon. See Bourdon's [`LICENSE_FAQ.md`](https://github.com/getbourdon/bourdon/blob/main/LICENSE_FAQ.md) for plain-English guidance, or contact <licensing@bourdon.ai>.
