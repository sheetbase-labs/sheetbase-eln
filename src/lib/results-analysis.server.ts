import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { z } from 'zod'

import type { LoadedInput } from './code-cells/run.server'
import {
  findExperiment,
  invalid,
  likeValue,
  toolDef,
} from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { ProviderToolDef } from './ai-providers/types'
import type { AssistantProposal } from './assistant-proposals'
import { snapshotDataset } from './dataset-product'
import { readAllResultRows } from '#/features/measurement-results/data'
import {
  findMeasurementTable,
  resultQueryFor,
} from '#/features/measurement-results/reads.server'
import { recordDestination } from './navigation'
import {
  ANALYSIS_ADD_SAVED_TOOL,
  ANALYSIS_ADD_TOOL,
  ANALYSIS_HEADINGS,
  ANALYSIS_INPUT_ALIAS,
  ANALYSIS_RUN_TOOL,
  analysisRunSchema,
  analysisSource,
  proposeAnalysisAddSavedSchema,
  proposeAnalysisAddSchema,
} from './results-analysis'
import type {
  AnalysisKind,
  AnalysisParams,
  AnalysisSettings,
} from './results-analysis'

/**
 * The Python runner and the session code load when an analysis runs, not when
 * the assistant starts (a feature's server half is loaded with every chat).
 *
 * The server half of results analysis (see `results-analysis.ts`): the run
 * tool that answers with numbers and the card that puts them in a notebook.
 */

type ReadResult = { text: string; isError: boolean }

type Outcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const ANALYSIS_FILE = 'results-analysis/python/results_analysis.py'

let template: Promise<string> | null = null

/** The analysis code, read once from the plugin that ships it. */
async function readTemplate(): Promise<string> {
  const { pluginsDirectory } = await import('./extensions/built-in.server')

  return readFile(join(pluginsDirectory(), ANALYSIS_FILE), 'utf8')
}

async function analysisTemplate(): Promise<string> {
  template ??= readTemplate()

  try {
    return await template
  } catch (error) {
    template = null
    throw error
  }
}

export function analysisReadDefs(): ProviderToolDef[] {
  return [
    toolDef(
      ANALYSIS_RUN_TOOL,
      'Analyse the rows of a dataset, or of one kind of result (a measurement table) across all the datasets that hold it, with Python and answer with the numbers: fit a four-parameter dose-response curve per group (EC50, slope, bottom, top, R²), read samples off a standard curve, or compare groups with a t-test or ANOVA. Nothing is stored and nothing in the notebook changes. Use it first, say what the numbers mean in plain words, then propose adding the analysis to the experiment’s notebook. Name columns by their label.',
      analysisRunSchema,
    ),
  ]
}

export function analysisProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      ANALYSIS_ADD_TOOL,
      'Propose adding an analysis to an experiment’s notebook: a Python cell that runs the analysis on the dataset and shows the table and plot, and a short summary you write after it, marked as a draft. Run the analysis with the run tool first and write the summary only from its numbers. The person sees a card and presses a button; nothing changes until they do, and the summary is theirs to edit afterwards.',
      proposeAnalysisAddSchema,
    ),
    toolDef(
      ANALYSIS_ADD_SAVED_TOOL,
      'Propose putting an analysis the person already saved in the Analysis Studio (a regression, dose-response curve, group comparison or survival fit) into an experiment’s notebook as a live block. The block shows the plot and key numbers and keeps itself current as the analysis or its data change. The person sees a card and presses a button; nothing changes until they do.',
      proposeAnalysisAddSavedSchema,
    ),
  ]
}

export const isAnalysisReadTool = (name: string): boolean =>
  name === ANALYSIS_RUN_TOOL

export const isAnalysisProposalTool = (name: string): boolean =>
  name === ANALYSIS_ADD_TOOL || name === ANALYSIS_ADD_SAVED_TOOL

interface DatasetRow {
  id: string
  name: string
  display_id: string | null
  revision: number
}

interface VersionRow {
  id: string
  label: string
  created_at: string
}

type Found =
  | { ok: true; input: LoadedInput; dataset: DatasetRow }
  | { ok: false; message: string }

const label = (row: DatasetRow) =>
  row.display_id ? `${row.display_id} ${row.name}` : row.name

/** The dataset the person named, at the snapshot they named or the latest, with its rows. */
async function loadDataset(
  context: LabToolContext,
  text: string,
  snapshot: string | undefined,
): Promise<Found> {
  const like = likeValue(text)

  const datasets = await context.client.list<DatasetRow>(
    'datasets',
    `?or=(name.ilike.${like},display_id.ilike.${like})&select=id,name,display_id,revision&order=updated_at.desc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  const exact = datasets.filter(
    (row) =>
      row.name.toLowerCase() === lower ||
      row.display_id?.toLowerCase() === lower,
  )

  const matches = exact.length === 1 ? exact : datasets

  if (matches.length === 0)
    return { ok: false, message: `No dataset matches "${text}".` }

  if (matches.length > 1)
    return {
      ok: false,
      message: `More than one dataset matches "${text}": ${matches
        .map(label)
        .join(', ')}. Ask which one.`,
    }

  const dataset = matches[0]

  const versions = await context.client.list<VersionRow>(
    'dataset_versions',
    `?dataset_id=eq.${encodeURIComponent(dataset.id)}${
      snapshot ? `&label=ilike.${likeValue(snapshot)}` : ''
    }&select=id,label,created_at&order=created_at.desc&limit=1`,
  )

  if (versions.length === 0 && snapshot)
    return {
      ok: false,
      message: `${label(dataset)} has no snapshot called "${snapshot}".`,
    }

  if (versions.length === 0) {
    // A run is recorded against exact rows, so a dataset with no snapshot gets
    // one now, made as the person; it is a kept copy and changes nothing.
    try {
      const made = await snapshotDataset(context.client, {
        datasetId: dataset.id,
        expectedRevision: dataset.revision,
        label: `Analysis ${new Date().toISOString().slice(0, 10)}`,
      })

      versions.push({
        id: made.id,
        label: made.label,
        created_at: made.created_at,
      })
    } catch (error) {
      return {
        ok: false,
        message: `${label(dataset)} has no snapshot and one could not be made: ${error instanceof Error ? error.message : 'denied'}.`,
      }
    }
  }

  const { loadInputs } = await import('./code-cells/run.server')

  const [input] = await loadInputs(context.client, [
    { alias: ANALYSIS_INPUT_ALIAS, datasetVersionId: versions[0].id },
  ])

  return { ok: true, input, dataset }
}

/** The columns that say where a row of a table read across datasets came from. */
export const SOURCE_DATASET_KEY = 'source_dataset'
export const SOURCE_SNAPSHOT_KEY = 'source_snapshot'

type TableFound =
  | { ok: true; input: LoadedInput; description: string }
  | { ok: false; message: string }

/**
 * One measurement table across every dataset that holds it, as an analysis
 * input: the rows of all of them together, each with the dataset and snapshot
 * it came from. Read as the person, so a dataset they cannot open is not in it.
 */
export async function loadTable(
  context: LabToolContext,
  args: z.infer<typeof analysisRunSchema>,
): Promise<TableFound> {
  const table = await findMeasurementTable(context.client, args.table ?? '')

  if ('message' in table) return { ok: false, message: table.message }

  const built = await resultQueryFor(context.client, {
    datasets: args.tableDatasets,
    record: args.tableRecord,
    snapshots:
      args.snapshot?.trim().toLowerCase() === 'latest' ? 'latest' : 'live',
  })

  if ('message' in built) return { ok: false, message: built.message }

  const result = await readAllResultRows(context.client, table.id, built.query)

  if (result.rows.length === 0)
    return {
      ok: false,
      message: `${table.name} has no rows in the datasets you can open${result.skipped.length > 0 ? ` (${result.skipped.length} had no snapshot)` : ''}.`,
    }

  if (result.truncated)
    return {
      ok: false,
      message: `${table.name} has ${result.totalCount} rows across datasets, which is more than an analysis reads. Choose fewer datasets.`,
    }

  const rows = result.rows.map((row) => ({
    ...Object.fromEntries(
      Object.entries(row.values).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join('; ') : value,
      ]),
    ),
    [SOURCE_DATASET_KEY]: row.datasetDisplayId ?? row.datasetName,
    [SOURCE_SNAPSHOT_KEY]: row.live
      ? 'live'
      : (row.snapshotLabel ?? 'snapshot'),
  }))

  return {
    ok: true,
    description: `${table.name} across ${result.sources.length} dataset${result.sources.length === 1 ? '' : 's'} (${result.sources
      .map((source) => source.displayId ?? source.name)
      .join(', ')}), ${rows.length} rows`,
    input: {
      alias: ANALYSIS_INPUT_ALIAS,
      datasetVersionId: '',
      label: table.name,
      columns: [
        ...result.columns.map((column) => ({
          key: column.key,
          label: column.label,
          type: column.logicalType,
        })),
        { key: SOURCE_DATASET_KEY, label: 'Dataset', type: 'text' },
        { key: SOURCE_SNAPSHOT_KEY, label: 'Snapshot', type: 'text' },
      ],
      rows,
      rowCount: rows.length,
      digest: '',
    },
  }
}

/** A column named by its label or key, as the table spells it. */
function columnKey(input: LoadedInput, name: string): string | null {
  const lower = name.trim().toLowerCase()

  const found = input.columns.find(
    (column) =>
      column.key.toLowerCase() === lower ||
      column.label.toLowerCase() === lower,
  )

  return found?.key ?? null
}

/** The columns each kind of analysis cannot run without. */
const NEEDS = {
  dose_response: ['x', 'y'],
  standard_curve: ['x', 'y'],
  compare_groups: ['group', 'y'],
} as const satisfies Record<AnalysisKind, readonly ('x' | 'y' | 'group')[]>

/** The settings with every column named by its key; a message when one is not there. */
function settingsFor(
  input: LoadedInput,
  args: AnalysisSettings,
): { ok: true; settings: AnalysisParams } | { ok: false; message: string } {
  const settings: AnalysisParams = {
    kind: args.kind,
    input: ANALYSIS_INPUT_ALIAS,
    model: args.model,
    unit: args.unit,
  }

  const labelOf = new Map(
    input.columns.map((column) => [column.key, column.label]),
  )

  for (const field of ['x', 'y', 'group', 'label'] as const) {
    const wanted = args[field]

    if (!wanted) continue
    const key = columnKey(input, wanted)

    if (!key)
      return {
        ok: false,
        message: `There is no column "${wanted}". The columns are: ${input.columns
          .map((column) => column.label)
          .join(', ')}.`,
      }
    settings[field] = key

    const shown = labelOf.get(key)

    if (shown && shown !== key)
      settings.labels = { ...settings.labels, [field]: shown }
  }

  const missing = NEEDS[args.kind].filter((field) => !settings[field])

  if (missing.length > 0)
    return {
      ok: false,
      message: `A ${args.kind.replaceAll('_', ' ')} needs ${missing
        .map((field) => `the ${field} column`)
        .join(' and ')}. The columns are: ${input.columns
        .map((column) => column.label)
        .join(', ')}.`,
    }

  return { ok: true, settings }
}

export async function runAnalysisReadTool(
  _name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw tool arguments from the assistant; analysisRunSchema decodes them below.
  args: unknown,
  context: LabToolContext,
): Promise<ReadResult> {
  const parsed = analysisRunSchema.safeParse(args)

  if (!parsed.success) return { text: invalid(parsed.error), isError: true }

  try {
    const found = parsed.data.table
      ? await loadTable(context, parsed.data)
      : await loadDataset(
          context,
          parsed.data.dataset ?? '',
          parsed.data.snapshot,
        )

    if (!found.ok) return { text: found.message, isError: true }
    const chosen = settingsFor(found.input, parsed.data)

    if (!chosen.ok) return { text: chosen.message, isError: true }
    const source = analysisSource(await analysisTemplate(), chosen.settings)

    const { runPython } = await import('./code-cells/run.server')

    const result = await runPython({
      source,
      inputs: { [ANALYSIS_INPUT_ALIAS]: found.input.rows },
    })

    const figures = result.rows.filter((row) => row['kind'] === 'figure').length

    const table = result.rows
      .filter((row) => row['kind'] !== 'figure')
      .slice(0, 60)

    return {
      text: JSON.stringify({
        dataset:
          'description' in found
            ? found.description
            : `${label(found.dataset)} (${found.input.label}, ${found.input.rowCount} rows)`,
        results: table,
        figures,
        note: 'Nothing is stored. To put this in the notebook, propose it with the add-to-notebook tool and write the summary only from these numbers.',
        logs: result.logs.slice(0, 10),
      }),
      isError: false,
    }
  } catch (error) {
    const { CodeCellError } = await import('./code-cells/run.server')

    if (error instanceof CodeCellError)
      return { text: error.message, isError: true }

    return { text: 'The analysis could not be run just now.', isError: true }
  }
}

const clip = (text: string, length = 3_000) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text

export async function buildAnalysisProposal(
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The model's tool call arrives as JSON; proposeAnalysisAddSchema decodes it below.
  args: unknown,
  context: LabToolContext,
): Promise<Outcome> {
  if (name === ANALYSIS_ADD_SAVED_TOOL)
    return buildSavedAnalysisProposal(args, context)

  if (name !== ANALYSIS_ADD_TOOL) return { ok: false, message: 'Unknown tool.' }
  const parsed = proposeAnalysisAddSchema.safeParse(args)

  if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
  const input = parsed.data
  const experiment = await findExperiment(context.client, input.experiment)

  if ('message' in experiment) return { ok: false, message: experiment.message }
  const found = await loadDataset(context, input.dataset, input.snapshot)

  if (!found.ok) return { ok: false, message: found.message }
  const chosen = settingsFor(found.input, input)

  if (!chosen.ok) return { ok: false, message: chosen.message }

  let source: string

  try {
    source = analysisSource(await analysisTemplate(), chosen.settings)
  } catch {
    return { ok: false, message: 'The analysis code is not available.' }
  }

  const heading = ANALYSIS_HEADINGS[input.kind]
  const version = `${label(found.dataset)} · ${found.input.label}`

  return {
    ok: true,
    proposal: {
      tool: ANALYSIS_ADD_TOOL,
      title: input.title,
      summary: input.summary,
      target: `${experiment.identifier} · Notebook`,
      deepLink: recordDestination('experiment', experiment.id),
      changes: [
        {
          label: 'Experiment',
          before: null,
          after: `${experiment.identifier} ${experiment.title}`,
        },
        { label: 'Analysis', before: null, after: `${heading} on ${version}` },
        {
          label: 'Adds',
          before: null,
          after: 'A Python cell with the table and plot, then a draft summary',
        },
        {
          label: 'Draft summary',
          before: null,
          after: clip(input.draftSummary),
        },
      ],
      action: {
        kind: 'analysis.add_to_notebook',
        recordId: experiment.id,
        source,
        datasetVersionId: found.input.datasetVersionId,
        versionLabel: version,
        draftSummary: input.draftSummary,
        heading,
      },
    },
  }
}

interface SavedAnalysisRow {
  id: string
  name: string
  display_id: string | null
  version: number
}

/** The saved analysis the person named, by name or id; ask which when it is not clear. */
async function findSavedAnalysis(
  context: LabToolContext,
  text: string,
): Promise<
  { ok: true; row: SavedAnalysisRow } | { ok: false; message: string }
> {
  const like = likeValue(text)

  const rows = await context.client.list<SavedAnalysisRow>(
    'analysis_definitions',
    `?or=(name.ilike.${like},display_id.ilike.${like})&select=id,name,display_id,version&order=updated_at.desc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  const exact = rows.filter(
    (row) =>
      row.name.toLowerCase() === lower ||
      row.display_id?.toLowerCase() === lower,
  )

  const pool = exact.length > 0 ? exact : rows
  const [only] = pool

  if (pool.length === 0)
    return { ok: false, message: `No saved analysis matches “${text}”.` }

  if (pool.length > 1)
    return {
      ok: false,
      message: `More than one saved analysis matches “${text}”: ${pool
        .map((row) =>
          row.display_id ? `${row.display_id} ${row.name}` : row.name,
        )
        .join(', ')}. Ask which one.`,
    }

  return { ok: true, row: only }
}

async function buildSavedAnalysisProposal(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The model's tool call arrives as JSON; proposeAnalysisAddSavedSchema decodes it below.
  args: unknown,
  context: LabToolContext,
): Promise<Outcome> {
  const parsed = proposeAnalysisAddSavedSchema.safeParse(args)

  if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
  const input = parsed.data
  const experiment = await findExperiment(context.client, input.experiment)

  if ('message' in experiment) return { ok: false, message: experiment.message }
  const found = await findSavedAnalysis(context, input.analysis)

  if (!found.ok) return found

  const name = found.row.display_id
    ? `${found.row.display_id} ${found.row.name}`
    : found.row.name

  return {
    ok: true,
    proposal: {
      tool: ANALYSIS_ADD_SAVED_TOOL,
      title: input.title,
      summary: input.summary,
      target: `${experiment.identifier} · Notebook`,
      deepLink: recordDestination('experiment', experiment.id),
      changes: [
        {
          label: 'Experiment',
          before: null,
          after: `${experiment.identifier} ${experiment.title}`,
        },
        {
          label: 'Analysis',
          before: null,
          after: `${name} (v${found.row.version})`,
        },
        {
          label: 'Adds',
          before: null,
          after:
            'A live block with the plot and key numbers, kept current as the analysis or its data change',
        },
      ],
      action: {
        kind: 'analysis.add_saved',
        recordId: experiment.id,
        definitionId: found.row.id,
        title: found.row.name,
      },
    },
  }
}
