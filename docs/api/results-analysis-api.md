# Results analysis

Fit a dose-response curve, read samples off a standard curve, or compare
groups, then put the result in an experiment's notebook as a draft. One
analysis file, `plugins/results-analysis/python/results_analysis.py`, does all
of it, and it reaches people and tools four ways.

| Surface    | How                                                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assistant  | `sheetbase.analysis.run` (a read: runs the analysis on a dataset and answers with the numbers, stores nothing) and `sheetbase.analysis.add_to_notebook` (a card: see below) |
| API        | the plugin operation `analyse`: `POST /api/plugins/results-analysis/analyse` with `{ "input": { "kind", "rows", … } }`                                                      |
| MCP        | the plugin operation, as the tool `plugin.results-analysis.analyse`                                                                                                         |
| Pipelines  | the plugin operation, as a plugin step                                                                                                                                      |
| Python SDK | `client.plugins.call("results-analysis", "analyse", {...})`                                                                                                                 |
| Notebook   | the cell it adds is an ordinary `code_cell` block, so `code_cell.run` and `code_cell.reproduced` fire as for any cell (see [code cells](code-cells-api.md))                 |

The plugin is built in: it installs with the others when **Settings → Plugins**
opens, and an administrator can switch it off there like any plugin. It needs
the Python runner. It has no packages to install and reaches no host.

## The operation

`analyse` reads rows you send; it does not read the lab's data by itself, so
nothing leaves a dataset unless the caller sends it.

| Input   | Type | For                                                                                                            |
| ------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| `kind`  | text | `dose_response`, `standard_curve` or `compare_groups` (required)                                               |
| `rows`  | json | a list of objects, one per row, keyed by column (required)                                                     |
| `y`     | text | the response or signal column, or the values compared (required)                                               |
| `x`     | text | `dose_response`: the dose column. `standard_curve`: each standard's known value; blank for the samples to read |
| `group` | text | `dose_response`: one curve per value. `compare_groups`: the group column                                       |
| `label` | text | `standard_curve`: names the samples                                                                            |
| `model` | text | `standard_curve`: `linear` (default) or `4pl`                                                                  |
| `unit`  | text | `dose_response`: the dose unit for the axis                                                                    |

It answers `{ results, figures, summary }`: the table rows (`kind` is `result`,
`curve`, `sample`, `group` or `test`), each plot as `{ title, image }` where
`image` is an SVG data URL, and a plain-language summary of the numbers.

- **`dose_response`**: a four-parameter logistic fitted per group to every
  point (doses above zero): EC50 with a 95% interval, slope (negative for a
  falling curve), bottom, top and R². A group with fewer than four doses is
  reported as not fitted, with the reason, not dropped.
- **`standard_curve`**: fits the rows that have a known value and reads the
  others off the curve. A sample whose signal falls outside the standards is
  marked `no: outside the standards` and should not be reported as a number.
- **`compare_groups`**: Welch's t-test for two groups; one-way ANOVA with Tukey
  HSD for three or more; mean, SD and SEM for each.

## The notebook card

`sheetbase.analysis.add_to_notebook` takes the experiment, a dataset (and
optionally a snapshot label), the same settings, and the draft summary the
assistant wrote from the run's numbers. The person sees a card with the code's
settings and the summary text. A dataset with no snapshot gets one first (labelled "Analysis" and the date, made as the person), because a run is recorded against exact rows. Pressing the button, as them:

1. runs the analysis as a notebook code cell (recorded with the code, the data's
   digests and the runtime, so it can be reproduced);
2. adds a `code_cell` block with the table and plots;
3. adds a text block after it headed "(draft)", saying which run it came from,
   for the person to check and edit before signing.

If the analysis fails, nothing is added. The cell's code is the whole analysis
with the settings filled in at the top (`PARAMS`), so a scientist can change a
column or the model and run the cell again.

Analysing is not attestation: the assistant never signs, approves or decides
anything here, and the summary is a draft until the person edits and signs the
notebook themselves.

## A saved analysis in a notebook

The Analysis Studio saves a statistic (a regression, a dose-response curve, a
group comparison, a survival fit) as a **saved analysis**, readable on the
`analysis_definitions` table. `add_analysis_to_notebook` puts one into an
experiment's notebook as a live `analysis` block. The block holds only the
analysis's id and a title: it runs the analysis whenever the notebook opens, so
the table, the plot and the key numbers follow the analysis and its data. If the
analysis was made on a snapshot it stays on that snapshot. The experiment's
Results tab lists the same blocks with their headline numbers.

In the app this is **Save and add to EXP-…** in the studio, shown when the
studio was opened from an experiment. A person can also press **Cite in a
notebook…** to freeze the result on its dataset version instead.

### `add_analysis_to_notebook`

Scope: `lab:write`. Also a pipeline action.

| Argument             | Type | Notes                                                           |
| -------------------- | ---- | --------------------------------------------------------------- |
| `p_record_id` \*     | uuid | The experiment (`records.id`) whose notebook gets the analysis. |
| `p_definition_id` \* | uuid | The saved analysis (`analysis_definitions.id`).                 |
| `p_title`            | text | The block's title. The analysis's name if left out.             |

Returns `{ block, structure_version, already_there }`. Adding the same analysis
to the same notebook again changes nothing and returns the existing block with
`already_there: true`. A notebook that is submitted or signed refuses the new
block, as it does any other.

### Event

`analysis.added_to_notebook` (family `record`) carries `recordId`,
`definitionId`, `analysis` (its name), `title` and `blockId`; it can start a
pipeline. It fires whenever an analysis block naming a saved analysis is added to
a notebook, however it was added (this action, the block editor, “Cite in a
notebook” or a plain block insert), and not when the analysis was already there.

### From the assistant and MCP

The same action is an MCP action on `sheetbase.lab.act`, and the assistant
offers it as a confirm card, `sheetbase.analysis.add_saved_to_notebook`.
