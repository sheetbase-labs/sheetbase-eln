import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AnalysisResultTable } from '#/components/viz/analysis-panel'
import { runAnalysis } from '#/lib/analysis-definition'
import type { AnalysisDefinition } from '#/lib/analysis-definition'
import type { ChartColumn } from '#/lib/chart-spec'

/**
 * R5-STUDIO-01 result panel. Results come from the real kernel
 * (`runAnalysis`) over a static fixture, so the method summary, the tables
 * and the assumption checks are the ones the panel would report — nothing is
 * hand-written to look right.
 */
const DATASET_ID = '11111111-1111-1111-8111-111111111111'
const TIME = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01'
const RECOVERY = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02'
const CONDITION = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03'

const columns: ChartColumn[] = [
  { id: TIME, label: 'Time (h)', logicalType: 'decimal' },
  { id: RECOVERY, label: 'Recovery (%)', logicalType: 'decimal' },
  { id: CONDITION, label: 'Condition', logicalType: 'category' },
]

const rows: Record<string, unknown>[] = [
  { [TIME]: 2, [RECOVERY]: 88.1, [CONDITION]: '4 °C' },
  { [TIME]: 4, [RECOVERY]: 85.4, [CONDITION]: '4 °C' },
  { [TIME]: 6, [RECOVERY]: 82.9, [CONDITION]: '4 °C' },
  { [TIME]: 8, [RECOVERY]: 79.2, [CONDITION]: '4 °C' },
  { [TIME]: 2, [RECOVERY]: 74.6, [CONDITION]: '25 °C' },
  { [TIME]: 4, [RECOVERY]: 68.3, [CONDITION]: '25 °C' },
  { [TIME]: 6, [RECOVERY]: 61.7, [CONDITION]: '25 °C' },
  { [TIME]: 8, [RECOVERY]: 54.1, [CONDITION]: '25 °C' },
]

const descriptive: AnalysisDefinition = {
  definitionVersion: 1,
  datasets: [{ datasetId: DATASET_ID }],
  kind: 'descriptive',
  value: { fieldId: RECOVERY },
  group: { fieldId: CONDITION },
}

const regression: AnalysisDefinition = {
  definitionVersion: 1,
  datasets: [{ datasetId: DATASET_ID }],
  kind: 'regression',
  outcome: { fieldId: RECOVERY },
  predictor: { fieldId: TIME },
  degree: 1,
  group: { fieldId: CONDITION },
}

function resultOf(definition: AnalysisDefinition) {
  const outcome = runAnalysis(definition, columns, rows)
  if (!outcome.ok) throw new Error(`fixture did not run: ${outcome.error.code}`)
  return outcome.result
}

const meta = {
  title: 'Visualization/Analysis result table',
  component: AnalysisResultTable,
  tags: ['autodocs'],
  args: { result: resultOf(descriptive) },
} satisfies Meta<typeof AnalysisResultTable>
export default meta
type Story = StoryObj<typeof meta>

/** Grouped descriptive statistics — one block per condition, plus ANOVA. */
export const Descriptive: Story = {}

/** Polynomial regression: the term table reports estimates with intervals. */
export const Regression: Story = {
  args: { result: resultOf(regression) },
}

/** A single ungrouped run reports under the `all` group. */
export const SingleGroup: Story = {
  args: {
    result: resultOf({
      definitionVersion: 1,
      datasets: [{ datasetId: DATASET_ID }],
      kind: 'descriptive',
      value: { fieldId: RECOVERY },
    }),
  },
}
