# Workspace set-up, search and conflicts API

Setting up the workspace, the starter tables, who can join by email domain,
the regulated-lab rules, what you may do, the category vocabularies, the
search helpers, sheet cell conflicts, filing planner work under a study and
the storage places samples name are reachable with a token, from the
assistant, over MCP, in pipelines and through webhooks, the same way as the
rest of the lab (see [lab-api.md](lab-api.md) for scopes and how tokens work).

- Reads need `lab:read`; actions need `lab:write` and run as the person a
  **personal token** belongs to. The database makes the same checks as the
  app: set-up needs workspace admin, starter tables need to edit tables, join
  domains need to manage members and the regulated-lab switch needs to manage
  General settings.
- Tables are read through `GET /api/db/<table>`; actions are
  `POST /api/db/rpc/<name>` with the `p_` arguments. Over MCP, actions run
  through `sheetbase.lab.act` and tables through `sheetbase.canonical.read`,
  under the workspace's agent permissions. Switching the regulated-lab rules
  asks first by default.
- Files are uploaded through `POST /api/files` and the MCP file tools with a
  personal token holding `files:write`; the database steps behind an upload
  are not called on their own. Quarantining, restoring and deleting a file
  are `quarantine_file`, `restore_file` and `delete_file`.
- Accepting an invitation stays with the invited person, in the app.
- Webhook events: `workspace.setup.completed`,
  `workspace.join_domains.changed` and `workspace.regulated_lab.changed`.
  All three can start a pipeline. See [event-catalogue.md](event-catalogue.md).

## Tables

| Table                      | What it holds                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_join_domains`   | Email domains whose people can join the workspace themselves, and the role they join as. Change them with `set_join_domains`.             |
| `configuration_change_log` | Configuration changes made in bulk (record types, tables, templates), each with who made it, what kind it was and its result.             |
| `search_documents`         | What search finds: one row for each record, file, dataset, sheet, project and other thing you can see, with its title, ID, text and link. |
| `studies`                  | The study details of a study record: its summary, dates and plan version.                                                                 |
| `sheet_cell_conflicts`     | Sheet cells that changed in two places while one was offline, and how each was settled. Settle one with `resolve_cell_conflict`.          |

## Set-up and workspace rules

### `complete_workspace_setup`

Name the lab, set its time zone and add starter tables. The first set-up: the lab’s name (1 to 120 characters), its IANA time zone and which starter tables to add (`plate_reader`, `qpcr`, `chromatography`, `cell_counts`, `general`). Marks the workspace set up. Needs workspace admin. Returns `{ installed }`. Sends `workspace.setup.completed`.

Scope: `lab:write`.

| Argument           | Type   |                                          |
| ------------------ | ------ | ---------------------------------------- |
| `p_workspace_id` * | uuid   | Your workspace id.                       |
| `p_name` *         | text   | The lab’s name.                          |
| `p_timezone` *     | text   | IANA time zone, such as `Europe/London`. |
| `p_starter_keys`   | text[] | Starter tables to add, such as `qpcr`.   |

### `install_starter_structures`

Add starter measurement tables. Adds the starter measurement tables the workspace does not have yet (`plate_reader`, `qpcr`, `chromatography`, `cell_counts`, `general`); leave the list out for all of them. They are ordinary tables people can change. Needs to edit tables. Returns the keys added.

Scope: `lab:write`.

| Argument           | Type   |                                          |
| ------------------ | ------ | ---------------------------------------- |
| `p_workspace_id` * | uuid   | Your workspace id.                       |
| `p_keys`           | text[] | Which starter tables; leave out for all. |

### `set_join_domains`

Set the email domains whose people can join. Replaces the list of email domains whose people can join the workspace themselves, and the role they join as (`scientist`, `analyst`, `reviewer` or `viewer`). An empty list turns it off. You can only add your own verified email domain; public mail domains and domains another workspace has are refused. Needs to manage members. Returns `{ domains, role }`. Sends `workspace.join_domains.changed`.

Scope: `lab:write`.

| Argument           | Type   |                                       |
| ------------------ | ------ | ------------------------------------- |
| `p_workspace_id` * | uuid   | Your workspace id.                    |
| `p_domains` *      | text[] | Email domains, such as `example.com`. |
| `p_role`           | text   | The role people join as.              |

### `set_regulated_lab`

Turn the regulated-lab rules on or off. Turns on or off the rules regulated labs need (such as approving parsers before regulated data uses them). Needs to manage General settings. Returns the settings. Sends `workspace.regulated_lab.changed`.

Scope: `lab:write`.

| Argument           | Type |                    |
| ------------------ | ---- | ------------------ |
| `p_workspace_id` * | uuid | Your workspace id. |
| `p_regulated` *    | bool | On or off.         |

### `list_capabilities`

List the capabilities you have in the workspace. The capabilities you hold here, such as `schema.edit`, `pipelines.manage` or `sample.release`, from your role and groups.

Scope: `lab:read`.

| Argument           | Type |                    |
| ------------------ | ---- | ------------------ |
| `p_workspace_id` * | uuid | Your workspace id. |

### `list_configuration_vocabularies`

List every category field and its terms. Every category field in record types, measurement tables and sheet templates, with where it is, its terms and their lifecycle, a page at a time (up to 200). Returns `{ items, hasMore }`.

Scope: `lab:read`.

| Argument           | Type |                      |
| ------------------ | ---- | -------------------- |
| `p_workspace_id` * | uuid | Your workspace id.   |
| `p_limit`          | int  | Page size, 1 to 200. |
| `p_offset`         | int  | How many to skip.    |

## Search

### `search_cells`

Find words inside dataset cells. Finds words in the text cells of datasets you can see, with the dataset, the row, the field and a snippet, best match first.

Scope: `lab:read`.

| Argument    | Type |                    |
| ----------- | ---- | ------------------ |
| `p_query` * | text | The words to find. |
| `p_limit`   | int  | At most this many. |

### `search_did_you_mean`

Suggest things with a name close to the words. Records, projects and other things whose name or ID is close to what was typed, for a search that found nothing. Most similar first.

Scope: `lab:read`.

| Argument             | Type |                          |
| -------------------- | ---- | ------------------------ |
| `p_query` *          | text | What was typed.          |
| `p_limit`            | int  | At most this many.       |
| `p_include_archived` | bool | Include archived things. |

### `search_facets`

Count search matches by type, kind and project. How many things match a search, grouped by result type, kind and project, with the same filters as the search page. Leave a filter out to not filter on it.

Scope: `lab:read`.

| Argument             | Type |                            |
| -------------------- | ---- | -------------------------- |
| `p_query`            | text | The words to find.         |
| `p_project_id`       | uuid | Only this project.         |
| `p_kind`             | text | Only this kind.            |
| `p_status`           | text | Only this status.          |
| `p_owner_id`         | text | Only this owner (user id). |
| `p_date_from`        | ts   | Changed on or after.       |
| `p_date_to`          | ts   | Changed on or before.      |
| `p_result_type`      | text | Only this result type.     |
| `p_include_archived` | bool | Include archived.          |
| `p_filter`           | json | JSON field filter.         |

## Sheets, planning and samples

### `resolve_cell_conflict`

Settle a sheet cell that two people changed at once. Settles a cell that changed in two places while one was offline: the value to keep (either side’s, or another) and why. The decision goes into the sheet’s history under your name. Needs to edit the sheet. Returns the conflict.

Scope: `lab:write`.

| Argument          | Type |                             |
| ----------------- | ---- | --------------------------- |
| `p_conflict_id` * | uuid | Conflict id.                |
| `p_value` *       | json | The value to keep, as JSON. |
| `p_reason` *      | text | Why this value.             |

### `assign_planner_item_to_study`

File a planner workstream or task under a study. Puts a workstream (with its tasks that have no study) or a single task under a study. Give exactly one of the workstream and the task. Needs to edit both.

Scope: `lab:write`.

| Argument              | Type |                        |
| --------------------- | ---- | ---------------------- |
| `p_study_record_id` * | uuid | The study’s record id. |
| `p_workstream_id`     | uuid | A workstream.          |
| `p_task_id`           | uuid | A task.                |

### `sample_storage_locations`

List the storage places samples name. Every storage place named on a sample you can see that is not archived, once each.

Scope: `lab:read`.
