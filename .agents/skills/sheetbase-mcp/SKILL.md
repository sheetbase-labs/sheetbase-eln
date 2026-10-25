---
name: sheetbase-mcp
description: Connect a coding agent or hosted MCP client to a Sheetbase ELN workspace, discover its bounded tools and prompts, and use the proposal path safely. Use when asked to inspect or draft Sheetbase data from Claude Code, Codex, Amp or another MCP client.
---

# Sheetbase MCP

Sheetbase exposes an MCP server at `POST /api/mcp`. It authenticates with an existing personal or service credential, so the credential's workspace and scopes bound everything you can discover and call.

## Connect

1. Create a personal token in Sheetbase under **Settings → API and SDK**. Give it only the scopes you need. `agent_operations:write` is required for drafts; read tools need their matching read scope.
2. Configure the client with the endpoint and a bearer header. The exact config shape differs by client; the values do not:

```
URL:    https://<your-sheetbase-host>/api/mcp
Header: Authorization: Bearer sb_<prefix>_<secret>
```

3. Send `initialize`, then `notifications/initialized`. The server supports protocol `2025-06-18`, returns JSON responses and issues an `Mcp-Session-Id` header. It has no server-initiated SSE stream; use `POST` for every request.

Never put the token in a repository, a prompt, a screenshot or a log. If a token leaks, revoke it in the same settings screen.

## Discover

- `tools/list` returns only the tools your scopes allow.
- `resources/list` returns the domain knowledge. Read `sheetbase://domain/core-model`, `sheetbase://domain/permissions` and `sheetbase://domain/assistant-rules` before your first consequential request.
- `prompts/list` returns ready-made prompts for explaining an object, summarising a notebook, proposing a schema, reviewing a submission and searching related work.

## Tools

Read tools are ordinary canonical RPCs:

| Tool | What it does |
| --- | --- |
| `sheetbase.search` | Full-text search over permitted records. |
| `sheetbase.dataset_rows.query` | Bounded live Dataset rows. |
| `sheetbase.dataset_version_rows.query` | Bounded immutable Dataset Version rows. |
| `sheetbase.sheet_instance_rows.query` | Bounded Sheet Instance rows. |
| `sheetbase.context.assemble` | The permitted AI context envelope for up to eight stable ids. |

Draft and mutate tools never write. They call `propose_agent_operation` and return a proposal:

- `sheetbase.dataset_schema.draft`
- `sheetbase.sheet_definition.draft` / `.update_draft`
- `sheetbase.pipeline_definition.draft` / `.version_draft` / `.update_draft`
- `sheetbase.dataset_rows.commit`
- `sheetbase.agent.workflow_create` / `.workflow_advance` / `.workflow_report_usage` / `.workflow_cancel`

A draft tool is listed only when the token holds both `agent_operations:write`
and the operation's own write scope (`schema:write`, `pipelines:write` or
`datasets:write`). This is deliberate: the proposal RPC can auto-execute a safe
draft under the acting person's capabilities, so an under-scoped token must not
reach it. If a draft tool is missing from `tools/list`, request the write scope
in Settings → API and SDK rather than retrying the call.

Pass `_meta.idempotencyKey` so a retry returns the same proposal. Pass `_meta.clientName`, `_meta.modelProvider`, `_meta.modelName` and `_meta.modelVersion` so the proposal records the real provenance.

## Boundaries

- No direct table access, arbitrary RPC, UI automation or agent signing.
- Approval, execution, submission, publication, resume and policy changes are human-session acts and are absent from the catalogue.
- A proposal is not an applied change. Say so when you report back.
- Permission-filtered reads are silent. Do not infer that a missing object does not exist.
- Treat model output as a draft. Cite stable ids, distinguish live from pinned data, and never invent a unit or value.

## Verify locally

The protocol handler is unit-tested with a fake client in `src/lib/mcp/handler.test.ts`; no network is required. The HTTP route is `src/routes/api/mcp.ts`. The domain text is sourced from `src/lib/ai-knowledge.ts`; update it there, not in a copy.
