# Data in: open a dataset in a sheet

Getting a dataset in front of people in an experiment. A dataset made from a
file (a plain CSV or XLSX import) has no steward-made sheet definition, so a
sheet could not show it. The database now writes one from the dataset's own
columns, once per measurement table version, and makes the sheet from it.

## Actions

### `open_dataset_in_sheet`

Makes a new sheet that shows every column and row of a dataset, and puts it in
a notebook when you name one. The sheet definition behind it only mirrors the
columns the dataset already has: it adds no rule, calculation or write-back, so
it needs no authoring right. Anyone who may edit the notebook or the project
may open the data in a sheet. Also a pipeline action.

Scope: `datasets:write`.

| Argument               | Type | Notes                                                                             |
| ---------------------- | ---- | --------------------------------------------------------------------------------- |
| `p_dataset_id` \*      | uuid | The dataset to show.                                                              |
| `p_name`               | text | The sheet's name. Defaults to the dataset's name.                                 |
| `p_notebook_record_id` | uuid | An experiment or other notebook to put the sheet in.                              |
| `p_project_id`         | uuid | The project the sheet belongs to. Defaults to the notebook's, then the dataset's. |
| `p_after_block_id`     | uuid | Put the sheet right after this block of the notebook. Defaults to the end.        |

Returns `{ instance, definitionVersionId, block }`. `block` is the notebook
block when a notebook was named.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  https://app.example/api/db/rpc/open_dataset_in_sheet \
  -d '{"p_dataset_id":"<dataset id>","p_notebook_record_id":"<experiment id>"}'
```

## From the assistant and MCP

Ask the assistant to "put the ELISA data in a sheet in EXP-4302" and it offers
`sheetbase.sheet.open_dataset` as a confirm card. The same action is on
`sheetbase.lab.act` as `open_dataset_in_sheet`, under the workspace's agent
permissions.

## Events

Making the sheet sends the sheet's own change events (see
[event-catalogue.md](event-catalogue.md)); putting it in a notebook sends the
notebook's block events.
