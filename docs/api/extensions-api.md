# Extensions: pipeline actions, assistant tools and analysis kinds

An extension can add three kinds of work to a workspace, on top of object
actions, panels and commands. An administrator installs it from Settings →
Extensions (owners and admins only). Everything is fail-closed: a disabled or
removed extension, or a point an administrator has switched off, resolves to
nothing, never to an error.

| Point              | What it adds                                                                   | Where it shows                                |
| ------------------ | ------------------------------------------------------------------------------ | --------------------------------------------- |
| `pipeline-actions` | A step named `extension.<key>.<id>` with declared inputs and outputs           | Pipeline editor, run in the pipeline runner   |
| `assistant-tools`  | A tool named `extension.<key>.<id>`, `access` `read` or `write`                | The assistant in chat, and MCP `tools/list`   |
| `analysis-kinds`   | A Python analysis with a declared result shape (columns and an optional chart) | The analysis block, beside the built-in kinds |

## Manifest

Declarations live under `contributions` in the extension manifest. The
manifest is validated twice with the same rules: `src/lib/extensions/points.ts`
in TypeScript and `internal.validate_extension_runner_points` in SQL, so a
direct SQL install cannot bypass it.

- Ids match `^[a-z][a-z0-9-]{0,48}$`; field names `^[a-z][a-z0-9_]{0,47}$`.
- At most 24 fields per declaration and 25 declarations per point.
- A field has a `name`, a `type` (`text`, `number`, `integer`, `boolean`,
  `date` or `json`), and optional `required` and `description`.
- A runner is `{ "kind": "webhook", "url": "https://…" }` (https only, at most
  500 characters) or `{ "kind": "python", "code": "…" }` (at most 20 000
  characters). An analysis kind is Python only.
- A tool declares `access`: `read` or `write`. A write never runs on its own
  (see below).
- An analysis kind declares `result.columns` and an optional
  `result.chart` (`line`, `scatter` or `bar`, with a numeric `y`).

## Runners

**Python** code defines `run(input)` (pipeline actions and tools) returning an
object, or `run(data)` (analysis kinds) taking a pandas DataFrame whose columns
are the declared inputs and returning a DataFrame with the declared result
columns. It runs in the isolated pipeline Python runner
(`PIPELINE_PYTHON_RUNNER_URL`); there is no network and no database access.

**Webhook** runners receive a signed `POST`:

```json
{ "input": { … }, "context": { "extension": "acme.labels", "version": "1.0.0", "point": "assistant-tools", "id": "print-label" } }
```

with headers `x-sheetbase-extension`, `x-sheetbase-point`,
`x-sheetbase-timestamp` and
`x-sheetbase-signature: sha256=HMAC_SHA256(secret, "<timestamp>." + body)`.
Verify the signature with the extension's signing key (Settings → Extensions →
Make a signing key; shown once). Answer `200` with `{ "output": { … } }`; an
error status with `{ "error": { "message": "…" } }` shows that message to the
person. Addresses go through the same host policy as connector webhooks,
redirects are refused, the call times out at 30 seconds, and the answer is
capped at 1 MB. Inputs are checked against the declaration before the call and
the answer is checked against the declared outputs after it.

## Writes, approval and what an extension cannot do

- The assistant never runs a write tool directly. It shows a confirm card; the
  person presses Run, and the call is made as that person.
- Over MCP, a write tool goes through `request_agent_action` and the agent
  action policy (Auto, Ask or Never; default Ask). Approved requests run as the
  approver, in Agents → Lab actions.
- An extension cannot sign, submit, amend, lock, approve or attest. Those
  actions are never exposed through an extension tool.
- Viewers cannot run a write tool.

## Endpoints

All require a browser session with active workspace membership.

`POST /api/extensions/run` (60 requests a minute, 8 MB body)

```json
{ "kind": "tool", "extensionKey": "sample-tools", "toolId": "dilution-volumes", "input": { … } }
{ "kind": "analysis", "extensionKey": "sample-tools", "kindId": "moving-average", "rows": [ { … } ] }
```

Answers `{ "output": … }` or `{ "columns", "rows", "chart" }`. Errors carry a
`code` such as `not_installed`, `not_enabled`, `point_off`, `not_declared`,
`bad_input`, `bad_answer`, `address_refused`, `unreachable`, `timeout`,
`refused` or a Python error code.

`POST /api/extensions/key` (requires `extensions.manage`):
`{ "action": "rotate", "extensionKey": "…" }` returns the new key once;
`{ "action": "keys" }` lists which extensions have one.

RPC: `api.set_extension_point_enabled(workspace, extension, point, enabled)`
switches one point on or off (`extensions.manage`).

The endpoints are session-only on purpose: extensions are admin-installed and
their run endpoint is not part of the token API. Agents reach extension tools
through MCP.

## Pipelines and events

A pipeline step `extension.<key>.<id>` is accepted wherever a built-in action
is, except in propose mode. It is checked against the declared inputs when the
pipeline is saved and again when it runs.

Events (see the [event catalogue](./event-catalogue.md)):
`extension.point.enabled`, `extension.point.disabled` and `extension.invoked`
(`ok`, `runner`, `durationMs`, never the inputs or answers). Every run is also
audited with the extension identity, so it shows in the audit trail.
