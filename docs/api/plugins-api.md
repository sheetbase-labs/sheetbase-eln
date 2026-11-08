# Plugins: operations and analysis kinds

A plugin is Python code an owner or administrator installs from
**Settings → Plugins** to add work to a workspace. Everything is fail-closed: a
disabled or removed plugin, or a part an administrator has switched off, resolves
to nothing, never to an error. Plugins are Python only for now. The code runs in
the same isolated Python runner as pipeline Python steps (no network, no database,
no files except the plugin's own).

| Point            | What it adds                                                               | Where it shows                                                            |
| ---------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `operations`     | Something the plugin can do: named inputs in, named outputs back           | Assistant, MCP, pipelines and the API, all generated from one declaration |
| `analysis-kinds` | A Python analysis with a declared result shape (columns, optional a chart) | The analysis block, beside the built-in kinds                             |

The manifest also reserves a `ui` slot. It must be absent or `null` for now:
a plugin cannot bring its own screens yet.

## One declaration, every integration

An operation is declared once, in `plugin.json`. Sheetbase generates the rest
(`src/lib/extensions/operation-descriptors.ts`, through the same generators the
built-in operations use):

| Surface       | What is generated                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Assistant     | A tool named `plugin.<key>.<id>`. A `read` operation answers in the reply; a `write` operation shows a confirm card the person presses.          |
| MCP           | The same tool in `tools/list` for personal tokens. A `write` goes through `request_agent_action` and the agent action policy (Auto, Ask, Never). |
| API           | `POST /api/plugins/<key>/<id>` (below).                                                                                                          |
| Pipelines     | An action `plugin.<key>.<id>` in the pipeline editor and runner, with the declared inputs as arguments. Not in propose mode.                     |
| Webhooks, SSE | `extension.invoked` for every call, `extension.point.enabled` and `extension.point.disabled` when a part is switched.                            |
| Python SDK    | `client.plugins.call(key, operation, input)`.                                                                                                    |

`<key>` is the plugin's name in the workspace: the last part of its id
(`acme.cell-count` becomes `cell-count`).

## The package

A plugin is a `.sbplugin` zip: `plugin.json`, a `python/` folder, optional
`README.md` and `LICENSE`. `ui/` is refused (reserved). At most 100 files, 512 KiB
each, 2 MiB in all, 4 MiB for the zip. The same rules are checked on an author's
machine by `sheetbase-plugin validate` (see
[Build a plugin](../development/build-a-plugin.md)) and on upload, from shared
test cases, so they cannot drift.

`plugin.json` is validated in TypeScript (`src/lib/extensions/package.ts`,
`points.ts`) and, for the part that is stored, in SQL
(`internal.validate_extension_runner_points`), so a direct SQL install cannot
bypass it.

- Ids match `^[a-z][a-z0-9-]{0,48}$`; field names `^[a-z][a-z0-9_]{0,47}$`.
- At most 24 fields per declaration and 25 declarations per point.
- A field has a `name`, a `type` (`text`, `number`, `integer`, `boolean`, `date`
  or `json`), `required`, and an optional `description`.
- `run` is `module:function`, a function in the package's `python/` folder.
- An operation declares `access`: `read` or `write`. A write never runs on its
  own (see below).
- An analysis kind declares `result.columns` and an optional `result.chart`
  (`line`, `scatter` or `bar`, with a numeric `y`).
- `permissions` lists scopes (for example `projects:read`). A plugin without a
  network cannot use them yet; a manifest still carries at least one, so an empty
  list becomes `projects:read`.

## Functions

An operation function takes one dictionary of the declared inputs and returns one
dictionary of the declared outputs. An analysis function takes a pandas
DataFrame whose columns are the declared inputs and returns a DataFrame (or a
list of row dictionaries) with the declared result columns. Raise
`sheetbase_plugin.PluginError("…")` to refuse with a message a scientist can act
on; it is shown word for word. Any other exception is reported as the plugin
stopping with an error. Inputs are checked against the declaration before any
code runs, and the answer is checked against the declared outputs after it.

## Writes, approval and what a plugin cannot do

- The assistant never runs a write operation directly. It shows a confirm card;
  the person presses Run, and the call is made as that person.
- Over MCP a write goes through the agent action policy (default Ask). Approved
  requests run as the approver, in Agents → Lab actions.
- A plugin cannot sign, submit, amend, lock, approve or attest. Those actions
  are never exposed through a plugin.
- Viewers cannot run a write operation.
- A plugin never touches the database and receives no credential. What it
  returns is a result.

## Endpoints

`POST /api/plugins/install` (owners and admins, `extensions.manage`; session only)

- `?mode=check` unpacks the zip body, validates it and answers
  `{ "plugin": { id, name, version, description, author, permissions, adds,
fileCount, size, sha256, existing, changes } }` without storing anything.
  Errors are `400` with `{ "error": { "code": "invalid_package", "problems": [...] } }`.
- `?mode=install&acknowledge=1` does the same and installs it, or updates the
  install with the same plugin id (which comes back switched off until it is
  reviewed again). The code is stored by the server and never readable through
  the API.

`POST /api/plugins/<key>/<operation>` (60 requests a minute, 8 MB body)

```json
{ "input": { "live": 92, "dead": 8 } }
```

answers `{ "output": { "viability": 92, "total": 100 }, "durationMs": 120 }`. Call
it as the signed-in person or with a **personal** API token (never a service
token, so every call is attributed to a person). A `read` operation needs a
`:read` scope; a `write` operation needs `lab:write` and a role that can write.

`POST /api/plugins/run` (session only; what the assistant card and the analysis
block use)

```json
{ "kind": "operation", "extensionKey": "cell-count", "operationId": "viability", "input": { … } }
{ "kind": "analysis", "extensionKey": "cell-count", "kindId": "smooth", "rows": [ { … } ] }
```

Errors carry a short message and a status: `404` not installed or not declared,
`409` not enabled or the part switched off, `400` bad input, `502` the plugin
stopped or answered wrongly. `plugin_refused` messages are the plugin's own.

RPC: `api.set_extension_point_enabled(workspace, plugin, point, enabled)`
switches one point on or off (`extensions.manage`).

## Events

See the [event catalogue](./event-catalogue.md): `extension.point.enabled`,
`extension.point.disabled` and `extension.invoked` (`ok`, `runner`,
`durationMs`, never the inputs or answers). Every call is also audited with the
plugin's identity and the SHA-256 of the code that ran, so it shows in the audit
trail.
