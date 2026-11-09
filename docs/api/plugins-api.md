# Plugins: extension points

A plugin is Python code an owner or administrator installs from
**Settings → Plugins** to add work to a workspace. Everything is fail-closed: a
disabled or removed plugin, or a part an administrator has switched off, resolves
to nothing, never to an error. Plugins are Python only for now. The code runs in
the same isolated Python runner as pipeline Python steps (no database, no files
except the plugin's own, and no network except the hosts an administrator approved
for it). A plugin brings its own pip packages (RDKit, Biopython and so on), and how
much time, memory and data one call may use is a per-plugin setting an administrator
controls.

| Point                   | What it adds                                                                                         | Where it shows                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `operations`            | Something the plugin can do: named inputs in, named outputs back                                     | Assistant, MCP, pipelines and the API, all generated from one declaration       |
| `calculators`           | The same shape as an operation, read-only, shown as a form                                           | The bench calculator's "More" tab, and everywhere an operation shows            |
| `pipeline-steps`        | Combines or reshapes tables (DataFrames in, one DataFrame out)                                       | Pipelines, as an action `plugin.<key>.<id>`                                     |
| `analysis-kinds`        | A Python analysis with a declared result shape (columns, optional chart)                             | The analysis block, beside the built-in kinds                                   |
| `checks`                | Reads a table, answers `pass`, `warn` or `fail` with a message                                       | The `plugin_check` gate condition                                               |
| `search-providers`      | Finds records the built-in search cannot                                                             | "Found by plugins" on Search, the assistant and MCP semantic search             |
| `connectors`            | Pulls data in from a host it declared, as a table                                                    | Import → "Pull data in from another tool"                                       |
| `publishers`            | Sends a table to another system, to a host it declared (POST, PUT or PATCH)                          | Dataset menu "Send to…", pipeline plugin steps, assistant card, MCP, API        |
| `notification-channels` | Another way for a notification to reach a person, such as a Slack message                            | Settings → Notifications, "Other places to get notifications"                   |
| `importers`             | Reads a file type Sheetbase does not, into a table                                                   | Import                                                                          |
| `exporters`             | Writes a dataset as a file type Sheetbase does not                                                   | Dataset menu and `?format=plugin.<key>.<id>`                                    |
| `previews`              | Shows what is inside a file                                                                          | Notebook file blocks                                                            |
| `sameness-keys`         | Turns an entry's fields into a key; the same key means the same thing                                | Registry models: warning before a repeat is added                               |
| `event-hooks`           | Reacts to an event: notes, summaries, flags, sign-offs, field changes                                | Inbox (`plugin_note`), record panel, record fields                              |
| `record-hooks`          | Checks, fills in or follows up a save, an edit, a status change or a file upload                     | Saves and uploads (`422` on refusal), record panel, gates, search               |
| `instrument-parsers`    | Reads an instrument's own file into a table, matched by extension and optionally by text it contains | Import, and the list under Settings → Instruments                               |
| `label-formats`         | Lays out a label's text lines for the kinds it declares                                              | Label templates (Layout), sample labels and printing                            |
| `barcode-formats`       | Draws a code as bars (`1d`) or a grid (`2d`); an optional `parse` reads a scanned value back         | Label templates (Code), Scan and stocktake                                      |
| `storage-rules`         | Sees a sample and where it is going, answers `ok`, `warn` or `refuse` with a reason                  | Every move into a position or a free-text place (`422` on refusal)              |
| `blocks`                | A notebook block drawn by a Python screen or by the plugin's own page (`ui`)                         | The insert menu, under Plugin blocks                                            |
| `panels`                | A tab on record pages, drawn the same way, optionally only for some models                           | The record page's side tabs                                                     |
| `table-cells`           | How a value is drawn: text, number, badge, bar, sparkline or svg. Data only, never code in a cell    | Model record lists and sheet grids (a sheet column matches on its key and type) |
| `columns`               | A computed column (one value per row) with entries in its header menu                                | Model record lists                                                              |
| `row-actions`           | An action for the chosen rows (`one` or `many`)                                                      | Model record lists, above the table when rows are chosen                        |
| `field-types`           | A type for a model field: a base (text, integer, decimal), rules and a display                       | The Fields tab, record forms and lists                                          |

Every point has its own switch (`api.set_extension_point_enabled`), and a point
that is off resolves to nothing.

## Screens, cells and the sandboxed frame

A Python screen is **data**: a Python function returns a description built with
`sheetbase_plugin.ui` (stack, row, heading, text, stat, badge, bar, sparkline,
table, svg, inputs, button, form, link) and Sheetbase draws it with its own
components, so it follows the theme, works on a phone and never runs plugin code
in the page. The description is checked on the server and again in the browser:
SVG limited to a safe set of elements, no event handlers, scripts or web
addresses, and technical bounds of 64 levels, 100,000 parts and 4 MiB of state. A screen returns `{ view, state?, notice? }`;
`state` is passed back with the person's next click and a block keeps it.

A plugin that needs more brings a screen of its own: `ui` on a block, panel,
page, settings page, widget or report section names a file under `ui/` (HTML,
CSS, JavaScript, images and fonts inside the package). It runs in an iframe
with `sandbox="allow-scripts"` (an opaque origin: no cookies, no storage, no top
navigation) and a content security policy that allows inline and `eval`'d
script, WebAssembly, workers and `data:`/`blob:` assets but no network request,
served from
`GET /api/plugins/<key>/ui/<item>` for a signed-in member. The page talks to
Sheetbase through `sheetbase-ui.js`, which the server injects:
`sheetbase.onContext(fn)`, `sheetbase.call(operation, input)` (runs one of the
plugin's own operations as the person, and asks them first when it writes),
`sheetbase.setState(state)`, `sheetbase.notify(text)` and `sheetbase.resize()`.

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
`README.md` and `LICENSE`. `ui/` is refused (reserved). A package is bounded only
to keep a malformed zip from exhausting the server: by default 2,000 files, 16 MiB each,
64 MiB in all, 32 MiB for the zip. Each is an environment setting (`SHEETBASE_PLUGIN_MAX_FILES`, `SHEETBASE_PLUGIN_MAX_FILE_MB`, `SHEETBASE_PLUGIN_MAX_TOTAL_MB`, `SHEETBASE_PLUGIN_MAX_ARCHIVE_MB`) and `0` removes the bound. The same goes for what a connector or importer may handle: `SHEETBASE_PLUGIN_IMPORT_MAX_MB`, `SHEETBASE_PLUGIN_CONNECTOR_MAX_RESPONSE_MB`, `SHEETBASE_PLUGIN_CONNECTOR_MAX_REQUESTS` and `SHEETBASE_PLUGIN_SEARCH_MAX_DOCUMENTS`. The same rules are checked on an author's
machine by `sheetbase-plugin validate` (see
[Build a plugin](../development/build-a-plugin.md)) and on upload, from shared
test cases, so they cannot drift.

`plugin.json` is validated in TypeScript (`src/lib/extensions/package.ts`,
`points.ts`) and, for the part that is stored, in SQL
(`internal.validate_extension_runner_points`), so a direct SQL install cannot
bypass it.

- Ids match `^[a-z][a-z0-9-]{0,48}$`; field names `^[a-z][a-z0-9_]{0,47}$`.
- Sanity bounds of 500 fields per declaration and 1,000 declarations per point.
- `python` (optional) holds `requirements`, a list of pip requirement lines
  (`rdkit>=2024.3`, `biopython==1.84`, `pandas[performance]>=2`, or
  `name @ https://…`), and `network`, a list of host names the plugin's code may
  reach (`eutils.ncbi.nlm.nih.gov`, or `*.ebi.ac.uk` for sub-domains). Any
  package pip can install is allowed and there is no cap on how many. The
  administrator sees both lists before adding the plugin and approves them by
  adding it; an update that asks for more has to be approved again.
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

## Packages, hosts and limits

**Packages** are installed once, when the plugin is added, into an image the Python
runner keeps for that list of packages (plugins with the same list share it). A call
never installs anything and never waits on pip. Until the install ends the plugin's
calls answer `503` "still being installed"; if it fails they answer `502` with
pip's own message, and Settings → Plugins offers **Install again**.

**Hosts** are reachable from the plugin's code through an allow-listing proxy: the
approved names (exact, or `*.example.org`) on any port, and nothing else. A runner
with no egress network configured refuses a plugin that has approved hosts rather
than running it without them (see
[Python pipelines](../operations/pipeline-python.md)).

**Limits** are per plugin, set by an administrator in Settings → Plugins →
**Python settings**, kept across updates, and applied to every call (assistant,
MCP, pipelines, API, analysis block). Nothing caps what an administrator may give a
plugin; the defaults are what it gets until they change them:

| Setting                     | Default     | What happens past it                               |
| --------------------------- | ----------- | -------------------------------------------------- |
| Time (`timeoutSeconds`)     | 600 seconds | The call is stopped; the message names the setting |
| Memory (`memoryMb`)         | 4096 MB     | The call is stopped (out of memory)                |
| Processor cores (`cpus`)    | 2           | Calls share the cores                              |
| Processes and threads       | 512         | Starting more fails inside the call                |
| Scratch disk (`scratchMb`)  | 2048 MB     | Writing more fails inside the call                 |
| Data in a call (`dataMb`)   | 256 MB      | `413`; also the most the plugin can answer with    |
| Rows in a call (`rows`)     | 5,000,000   | `413` for a dataset, an error for an answer        |
| Calls per person per minute | no limit    | `429` with the time to wait                        |

## Endpoints

`POST /api/plugins/install` (owners and admins, `extensions.manage`; signed in, or a
personal API token with `admin:write`, so a script or CI job can ship a plugin:
`curl -X POST -H "Authorization: Bearer $TOKEN" --data-binary @my.sbplugin "$APP/api/plugins/install?mode=install&acknowledge=1"`)

- `?mode=check` unpacks the zip body, validates it and answers
  `{ "plugin": { id, name, version, description, author, permissions, python,
adds, fileCount, size, sha256, existing, changes } }` without storing anything.
  `python` is `{ requirements, network }`: what the administrator approves.
  Errors are `400` with `{ "error": { "code": "invalid_package", "problems": [...] } }`.
- `?mode=install&acknowledge=1` does the same and installs it, or updates the
  install with the same plugin id (which comes back switched off until it is
  reviewed again). The code is stored by the server and never readable through
  the API. It also starts installing the plugin's Python packages.

`GET /api/plugins/runtime` and `POST /api/plugins/runtime` (owners and admins,
`extensions.manage`; signed in, or a personal token with `admin:read` for GET and
`admin:write` for POST). GET answers `{ "runtime": [ { extensionId,
requirements, network, overrides, limits, environment: { state, error, packages } } ] }`
for every plugin: `overrides` is only what differs from the defaults, `limits` is
what it runs with, and `environment.state` is `none`, `building`, `ready`,
`failed` or `unavailable`. POST takes either

```json
{ "action": "set-limits", "extensionId": "…", "limits": { "memoryMb": 16384, "timeoutSeconds": 3600 } }
{ "action": "reinstall-packages", "extensionId": "…" }
```

`limits` holds only the settings to change from the defaults (an empty object
restores them all). Values must be positive numbers (whole except `cpus`);
`callsPerMinute` may be `null` for no limit. Each change is audited as
`extension.settings.changed`.

`POST /api/plugins/<key>/<operation>` (no rate limit or size limit of its own;
both are the plugin's settings above)

```json
{ "input": { "live": 92, "dead": 8 } }
```

answers `{ "output": { "viability": 92, "total": 100 }, "durationMs": 120 }`. Call
it as the signed-in person or with a **personal** API token (never a service
token, so every call is attributed to a person). A `read` operation needs a
`:read` scope; a `write` operation needs `lab:write` and a role that can write.

An operation may call into Sheetbase itself (`host_call` in its Python), as you,
under the same scopes the plugin declared. Calls that read are always made; a
call that changes something is made too when you are signed in or the token has
`lab:write`, otherwise it answers `403`. Pipeline steps do the same as the
person who runs the pipeline. A change an operation makes this way is saved as soon
as it is made: it is not undone if the operation fails later, or if the run is
run again.
The same operations are MCP tools (`plugin.<key>.<operation>`) and assistant
tools. For example the chemistry plugin's `find` (`mode`: `substructure` or
`similarity`) and `check` (is a structure already registered) are
`POST /api/plugins/chemistry/find` and `POST /api/plugins/chemistry/check`, with
`describe` for the formula, mass and parent of a molfile or SMILES line.

`POST /api/plugins/host` (session only; a plugin screen or Python operation
calling an MCP tool as the person: `{ extensionKey, point, name, arguments,
confirmed }`; a change answers `409 confirmation_needed` until `confirmed`) and
`POST /api/plugins/reindex` (owners and administrators, or their personal token
with `admin:write`; `{ extensionKey }`
brings the plugin's search index up to date for records saved before it was
added) sit beside it.

`POST /api/plugins/run` (session only; what the assistant card and the analysis
block use)

```json
{ "kind": "operation", "extensionKey": "cell-count", "operationId": "viability", "input": { … } }
{ "kind": "analysis", "extensionKey": "cell-count", "kindId": "smooth", "rows": [ { … } ] }
{ "kind": "screen", "extensionKey": "dilution", "point": "blocks", "itemId": "dilution", "context": { … }, "state": { … }, "event": { "action": "work", "values": { … } } }
{ "kind": "column", "extensionKey": "plate-tools", "itemId": "grade", "rows": [ { … } ] }
{ "kind": "column-action", "extensionKey": "plate-tools", "itemId": "grade", "actionId": "summary", "rows": [ { … } ] }
{ "kind": "row-action", "extensionKey": "plate-tools", "itemId": "export", "rows": [ { … } ] }
```

A screen answers `{ view, state?, notice? }`; a column answers one value per
row (`values`, the same length as `rows`, checked against the declared `value`
type); an action answers `{ notice?, view?, download? }` (a download is text up
to 2 MiB with a `text/*`, JSON or CSV type). A plugin sees only the rows it is
sent: at most 5000, and only the fields named in `inputs` when it declares them.
A row action with `selection: "one"` is refused for more than one row.

Errors carry a short message and a status: `404` not installed or not declared,
`409` not enabled or the part switched off, `400` bad input, `413` more data or
rows than the plugin is set up to take, `429` over the plugin's own rate, `503`
packages still installing, `502` the plugin stopped, ran out of time or memory,
could not install its packages or answered wrongly. `plugin_refused` messages are the plugin's own.

`GET /api/plugins/<key>/ui/<item>?point=<point>` (session only) serves one
plugin screen for the sandboxed frame; `point` is one of `blocks`, `panels`,
`pages`, `settings-pages`, `dashboard-widgets`, `report-sections`,
`table-cells` (the `render` page) or `field-types` (the `input` page), with `Content-Security-Policy` and `X-Frame-Options`
locked down; `404` when the plugin, the item or its page is not there or the
point is off.

### Sending data out

A **publisher** and a **notification channel** have no network of their own,
like a connector. The plugin's `run` function says which requests to make
(`{ "requests": [ { "method": "POST", "url": "https://…", "headers": { … }, "json": { … } } ] }`;
`method` is `POST`, `PUT` or `PATCH`, and a request has `body` (text) or `json`,
not both). Sheetbase makes them, only over HTTPS on the standard port, only to
the plugin's declared `hosts`, one after another and never following a
redirect, then hands the answers (`url`, `status`, `text`, `json`) to the
plugin's `parse` function. A publisher's `parse` returns
`{ "message": "…", "link": "https://…" }` (the link is optional); a channel's
`parse` is optional and raises `PluginError` when the service refused (Slack
answers `200` with `ok: false`); without it, any answer outside `2xx` is a
refusal. Each declares `settings` (an address, a token) that an administrator
sets once; a secret is sealed when saved and never returned.

A publisher is also a callable: it appears as the operation
`plugin.<key>.<id>` with `access: write`, inputs `rows` (a list of row
objects), `name` (optional) and its own `parameters`, and outputs `message`,
`link` and `requests`. So it is on the assistant (a confirm card), MCP, the
plugin API route, and pipelines (a plugin step bound to `{ "$ref": "previous" }`)
with no extra work, and each call is audited as `extension.invoked`.

- `POST /api/plugins/publish-dataset/<datasetId>` (session only, a role that can
  edit) sends a dataset's live rows: `{ "extensionKey", "publisherId", "parameters" }`
  answers `{ "message", "link?", "requests", "rows", "durationMs" }`. The server
  reads the rows with the caller's own access and records an export receipt.
- `GET /api/plugins/connections` and `POST /api/plugins/connections` (owners and
  admins, `extensions.manage`; session only, because the values can be secrets, and
  secrets are never taken over the API). GET answers
  `{ "connections": [ { extensionId, extensionKey, point, itemId, title, hosts, off, settings: [ { name, label, secret, required, isSet, value } ] } ] }`
  (`value` is only given for a setting that is not a secret). POST sets or
  clears: `{ "extensionId", "point", "itemId", "values": { "token": "…", "region": null } }`;
  a setting left out is kept. Each change is audited as
  `extension.settings.changed` with `setting: "connection"` and the setting
  names, never the values.
- `GET /api/plugins/channels` and `POST /api/plugins/channels` (any member, session
  only; each person sees and changes only their own). GET lists the channels of
  enabled plugins with `ready` (an administrator has set up every required
  setting) and the person's `mine`. POST takes
  `{ "action": "save", "extensionKey", "channelId", "destination", "scope": "phone" | "all" }`,
  `{ "action": "remove", … }` or `{ "action": "test", … }`.

A channel's messages follow the notifications the person already gets (a
notification that is muted everywhere is not written, so a channel can't send
it): `phone` follows the event's Phone setting, `all` every notification. A
message is queued by a trigger, sent by a worker every 15 seconds as the person,
held during their quiet hours, tried up to three times, and shows its last
failure in Settings → Notifications.

### Data points

`POST /api/plugins/data` (session only, 60 requests a minute, 16 MB body) is
what the app's own screens use for the data points. The body carries `kind` and
`extensionKey`, and the other fields depend on the kind:

| `kind`             | Also send                                   | Answers                                                 |
| ------------------ | ------------------------------------------- | ------------------------------------------------------- |
| `import`           | `importerId`, `filename`, `content`         | a table (`columns`, `rows`)                             |
| `connector`        | `connectorId`, `parameters`, `settings`     | a table; only the declared hosts are reached            |
| `export`           | `exporterId`, `name`, `rows`, `options`     | `{ filename, mime, content, encoding }`                 |
| `preview`          | `previewId`, `filename`, `content`          | `{ kind: "table" \| "text", … }`                        |
| `check`            | `checkId`, `rows`                           | `{ status, message }`                                   |
| `publish`          | `publisherId`, `name`, `rows`, `parameters` | `{ message, link?, requests }`; declared hosts only     |
| `sameness-key`     | `keyId`, `values`                           | `{ key }`                                               |
| `gate-check`       | `checkId`, `recordId`, `blockId`, `columns` | `{ status, message }`, stored for the gate              |
| `instrument-parse` | `parserId`, `filename`, `content`           | a table (`columns`, `rows`)                             |
| `barcode`          | `formatId`, `value`                         | `{ kind: "bars", modules }` or `{ kind: "grid", rows }` |
| `barcode-parse`    | `formatId`, `value`                         | `{ value }`, the code read, or `null`                   |
| `label`            | `formatId`, `record`                        | `{ lines: [{ text, bold }] }`, up to 12                 |

Importing, pulling and publishing need a role that can edit. `gate-check` reads the table
with the caller's own access and stores the answer in `api.gate_check_results`
with a hash of the table; only the server writes it, and the gate condition
`plugin_check` (`{ kind: "plugin_check", blockId, extensionKey, checkId, columns }`) reads it.
A changed table makes the stored answer stale, so the gate reads as not met
until the check is run again. `warn` counts as met.

Searching, event reactions and the same-thing key stored with an entry are
called by the server itself:

- Search runs every enabled provider on the signed-in person's own records
  (read through row-level security); service tokens get no plugin results.
- A reaction runs when the event is first seen in a workspace that has one
  switched on (a cursor per workspace; switching one on never replays old
  events). A note is written to `api.plugin_notes` once per event, for the
  person whose change it was, and stays visible to them.
- `api.set_registry_sameness_rule`, `api.registry_sameness_matches` and
  `api.set_registry_sameness_value` keep a model's rule, find entries with the
  same key and store an entry's key. A model with a rule only takes new entries
  through `api.create_registry_entry` with `p_sameness_value`, the key the rule
  gives (`/api/plugins/data`, kind `sameness-key`); any other way of adding one
  is refused, and a key that is already registered is refused unless
  `p_allow_duplicate` is true. The app does this itself for the add-entry
  screen, imports and the assistant. Editing an entry drops its key, so a repeat
  made by editing is not caught.

**Save and upload hooks** (`record-hooks`, see the plugin guide for the answer
shapes):

- A hook with `timing: before` is run by the server before a write reaches the
  database: through `/api/db/*`, the server's own data client, and file uploads
  (`POST /api/files`, new versions). The covered writes are `records`,
  `create_record`, `create_record_with_blocks`, `create_model_record`,
  `update_record_custom_fields`, `set_experiment_status`,
  `transition_record_status`, `start_experiment`, `release_sample`,
  `quarantine_sample` and `dispose_sample`. A refusal is `422` with the plugin's
  name and words (`code` `SB070`, or `plugin_refused` for an upload); words from
  `warn` come back in the `x-sheetbase-plugin-warnings` header. A hook that
  breaks never stops a save. Direct SQL and in-database calls that chain other
  changes only reach hooks with `timing: after`.
- A hook with `timing: after` is run from the change log, as the person whose
  change it was. What it answers is applied by the server: notes
  (`plugin_notes`), a summary (`plugin_record_outputs`), search entries
  (ranked with `api.search_plugin_index`), flags and sign-off steps
  (`plugin_flags`, `plugin_flag_sign_offs`) and field changes. Field changes
  are made with the person's own access under the client `plugin`, show up as
  ordinary `record.updated` events and are not fed back to any hook.
- A person presses a sign-off step in the app with `api.sign_off_plugin_step`;
  it checks their role, that they did not make the change when the step is
  independent, and the number of approvals. A plugin cannot sign, and the call is
  not on the token API.
- A gate condition `plugin_flag` (`{ kind, extensionKey, flagKey?, label? }`) is
  met while the plugin has nothing open on the experiment.

RPC: `api.set_extension_point_enabled(workspace, plugin, point, enabled)`
switches one point on or off (`extensions.manage`).
`api.set_field_plugin_type(kind, field, plugin, type)` gives a model field a
plugin's field type, or clears it when the plugin is null (needs permission to
edit models; listed in the [lab API](./lab-api.md)). `field_plugin_types` is
readable through the API. A record write that breaks the type's rules (lengths,
pattern, range) is refused with `SB071` and a message that names the field, on
every route a record is written, while the plugin is on and its `field-types`
point is switched on.

## Events

See the [event catalogue](./event-catalogue.md): `extension.point.enabled`,
`extension.point.disabled`, `extension.field_type.applied`,
`extension.field_type.removed`, `extension.settings.changed` (`setting` is `limits` or
`packages`) and `extension.invoked` (`ok`, `runner`,
`durationMs`, never the inputs or answers). Every call is also audited with the
plugin's identity and the SHA-256 of the code that ran, so it shows in the audit
trail.

### Storage rules and labels

A `storage-rules` item is shown a move before it happens: the sample, and the
place it is going (the names above it, the temperature it is kept at, the kind of
unit, how many positions the box has and how many are taken). It answers `ok`,
`warn` or `refuse` with words. A refusal stops the move and the person reads the
plugin's words (`422` from the data API); a warning lets it through and is shown
with the result in the `x-sheetbase-plugin-warnings` header. A rule that breaks
never stops a move. The failure is audited and the person is told the rule did
not run. Rules run for `move_sample_to_position` and `transfer_sample`, wherever
the call comes from (the place picker, scanning, bulk placing, the assistant,
pipelines and the API); direct SQL does not reach them.

`api.label_templates` has a `layout` column (`standard` or
`plugin.<key>.<id>`), and `barcode_type` may be `plugin.<key>.<id>` as well as
`qr` or `code128`. `api.save_label_template` takes `p_layout`. Plugin results are
data only (bars, a grid, lines of text), so no plugin code runs in a rendered label.

## Plugin steps inside a pipeline

A pipeline version's `configuration.steps` may hold a step run by a plugin, so
the pipeline API (`POST /api/pipelines/.../versions`) accepts it and the run
records it like any step (`pipeline_run_logs` stage `plugin`, an
`extension.invoked` audit event, and the step's digest in the run manifest):

```json
{
  "name": "subtract_blank",
  "language": "plugin",
  "statement": "",
  "plugin": {
    "operation": "plugin.bench-extras.subtract-blank",
    "arguments": {
      "readings": { "$ref": "previous" },
      "value_column": "value",
      "label_column": "label"
    }
  }
}
```

Tables take `previous`, `inputs.<name>` or `steps.<name>`; settings take a value
or `parameters.<name>`. Only a `pipeline-steps` item can run between steps.
