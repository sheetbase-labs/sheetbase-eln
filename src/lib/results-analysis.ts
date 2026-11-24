import { z } from 'zod'

/**
 * Results analysis from the assistant: fit a dose-response curve, read samples
 * off a standard curve or compare groups, on the rows of a dataset, and write
 * the result into the experiment's notebook as a draft for the person to
 * review.
 *
 * Two tools. `sheetbase.analysis.run` is a read: it runs the analysis on the
 * dataset as the person (the Python runner never sees more than they may read)
 * and answers with the numbers, so the model can say what they mean. Nothing is
 * stored. `sheetbase.analysis.add_to_notebook` is a card: when the person
 * presses the button the analysis runs again as a notebook code cell, which
 * records the run with the code, the data's digests and the runtime, and adds a
 * short summary after it, labelled as a draft. Same code, same data, same
 * numbers: the cell can be reproduced from its run.
 *
 * The analysis itself is `plugins/results-analysis/python/results_analysis.py`.
 * The same file is the plugin's operation (API, MCP, pipelines) and the source
 * of the code cell.
 */

export const ANALYSIS_RUN_TOOL = 'sheetbase.analysis.run'
export const ANALYSIS_ADD_TOOL = 'sheetbase.analysis.add_to_notebook'

export const ANALYSIS_ADD_SAVED_TOOL =
  'sheetbase.analysis.add_saved_to_notebook'

export const ANALYSIS_READ_TOOL_NAMES = [ANALYSIS_RUN_TOOL] as const

export const ANALYSIS_PROPOSE_TOOL_NAMES = [
  ANALYSIS_ADD_TOOL,
  ANALYSIS_ADD_SAVED_TOOL,
] as const

export type AnalysisProposeToolName =
  (typeof ANALYSIS_PROPOSE_TOOL_NAMES)[number]

export const ANALYSIS_KINDS = [
  'dose_response',
  'standard_curve',
  'compare_groups',
] as const

export type AnalysisKind = (typeof ANALYSIS_KINDS)[number]

/** The name the code cell reads the dataset by. */
export const ANALYSIS_INPUT_ALIAS = 'data'

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

const dataset = z
  .string()
  .min(1)
  .max(200)
  .describe('The dataset by name or display id.')

const column = (about: string) => z.string().min(1).max(120).describe(about)

const analysisSettingFields = {
  snapshot: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'The snapshot by its label. The latest one if left out. With `table`, "latest" reads each dataset’s newest snapshot and anything else reads the datasets live.',
    ),
  kind: z
    .enum(ANALYSIS_KINDS)
    .describe(
      'dose_response: a four-parameter curve per group (EC50 with a 95% interval, slope, bottom, top, R²). standard_curve: fit standards, read the other rows off the curve (DNA by PicoGreen, protein by BCA). compare_groups: Welch t-test for two groups, ANOVA with Tukey for more.',
    ),
  x: column(
    'dose_response: the dose or concentration column. standard_curve: the column with each standard’s known value, blank for the samples to read.',
  ).optional(),
  y: column(
    'The response or signal column (the values compared, for compare_groups).',
  ),
  group: column(
    'dose_response: a column that gives each group its own curve, such as the compound. compare_groups: the column naming the groups.',
  ).optional(),
  label: column('standard_curve: a column naming each sample.').optional(),
  model: z
    .enum(['linear', '4pl'])
    .optional()
    .describe('standard_curve only: linear (default) or 4pl.'),
  unit: z
    .string()
    .max(20)
    .optional()
    .describe('dose_response: the dose unit for the axis, such as nM.'),
}

const analysisFields = { dataset, ...analysisSettingFields }

/**
 * The run tool reads one dataset, or one measurement table across every
 * dataset that holds it (`table`), with the dataset and snapshot of each row in
 * the columns `source_dataset` and `source_snapshot`.
 */
export const analysisRunSchema = z
  .strictObject({
    dataset: dataset
      .optional()
      .describe(
        'One dataset by name or display id. Give this or `table`, not both.',
      ),
    table: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'One kind of result across datasets: a measurement table by name or key (for example ViCell or ddpcr_titre). Every dataset that holds it is read together, and each row says which dataset and snapshot it came from (columns source_dataset and source_snapshot, so they can be a group). Give this or `dataset`.',
      ),
    tableDatasets: z
      .array(z.string().min(1).max(200))
      .max(50)
      .optional()
      .describe(
        'With `table`: only these datasets, by name or display id such as DS-0297.',
      ),
    tableRecord: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'With `table`: only rows that link to this record, by identifier such as SMP-2231.',
      ),
    ...analysisSettingFields,
  })
  .refine((value) => Boolean(value.dataset) !== Boolean(value.table), {
    message: 'give exactly one of dataset and table',
    path: ['dataset'],
  })

export const proposeAnalysisAddSchema = z.strictObject({
  title,
  summary,
  experiment: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'The experiment whose notebook gets the analysis, by identifier such as EXP-0145 or by title.',
    ),
  ...analysisFields,
  draftSummary: z
    .string()
    .min(1)
    .max(3_000)
    .describe(
      'A short plain-language summary of what the analysis shows, written from the numbers the run tool returned and nothing else: what was fitted or compared, the key values with their units, and anything to check (a poor fit, samples outside the standards). Blank line between paragraphs; "- " for bullets. The person reviews it before it goes in.',
    ),
})

/** A saved analysis (one made in the Analysis Studio) goes in as a live block. */
export const proposeAnalysisAddSavedSchema = z.strictObject({
  title,
  summary,
  experiment: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'The experiment whose notebook gets the analysis, by identifier such as EXP-0145 or by title.',
    ),
  analysis: z
    .string()
    .min(1)
    .max(200)
    .describe('The saved analysis, by name or by id such as AN-0004.'),
})

export type AnalysisSettings = Pick<
  z.infer<typeof analysisRunSchema>,
  'kind' | 'x' | 'y' | 'group' | 'label' | 'model' | 'unit'
>

/** What an analysis card does when its button is pressed. */
export type AnalysisAction =
  | {
      kind: 'analysis.add_to_notebook'
      recordId: string
      /** The Python the code cell holds: the analysis with its settings filled in. */
      source: string
      datasetVersionId: string
      versionLabel: string
      /** The draft summary, as plain text for the notebook. */
      draftSummary: string
      /** What the analysis is, in a few words, for the summary block's heading. */
      heading: string
    }
  | {
      kind: 'analysis.add_saved'
      recordId: string
      definitionId: string
      title: string
    }

export type AnalysisActionKind = AnalysisAction['kind']

export function isAnalysisAction(action: {
  kind: string
}): action is AnalysisAction {
  return (
    action.kind === 'analysis.add_to_notebook' ||
    action.kind === 'analysis.add_saved'
  )
}

export interface AnalysisActionResult {
  openHref?: string
}

/** The settings the analysis file reads from its `PARAMS` line. */
export interface AnalysisParams {
  kind: AnalysisKind
  /** The name the cell reads the dataset by. */
  input: string
  x?: string
  y?: string
  group?: string
  label?: string
  model?: string
  unit?: string
  /** What the plots call each column, by role, so an axis reads "Inhibition (%)" and not `response`. */
  labels?: { x?: string; y?: string; group?: string; label?: string }
}

/** A Python string literal. JSON's escapes are valid Python's. */
const pythonString = (value: string) => JSON.stringify(value)

const SETTINGS_LINE = /^PARAMS = \{\} {2}# sheetbase:settings$/m

/**
 * The code a cell holds: the analysis file with its settings line replaced by
 * the settings, so anyone reading the notebook sees what was asked and can
 * change it and run the cell again.
 */
export function analysisSource(
  template: string,
  settings: AnalysisParams,
): string {
  if (!SETTINGS_LINE.test(template))
    throw new Error('The analysis code has no settings line.')

  const { labels, ...plain } = settings

  const pairs = (entries: ReadonlyArray<[string, string | undefined]>) =>
    entries.flatMap(([key, value]) =>
      value === undefined || value === ''
        ? []
        : [`${pythonString(key)}: ${pythonString(value)}`],
    )

  const named = labels ? pairs(Object.entries(labels)) : []

  const literal = `{${[
    ...pairs(Object.entries(plain)),
    ...(named.length > 0 ? [`"labels": {${named.join(', ')}}`] : []),
  ].join(', ')}}`

  return template.replace(SETTINGS_LINE, () => `PARAMS = ${literal}`)
}

/** The words of the summary heading for each kind of analysis. */
export const ANALYSIS_HEADINGS: Record<AnalysisKind, string> = {
  dose_response: 'Dose-response fit',
  standard_curve: 'Standard curve',
  compare_groups: 'Group comparison',
}
