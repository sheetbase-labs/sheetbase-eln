import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  ClearSystemFlagDialog,
  MarkOutOfRangeDialog,
  ValueActions,
} from '#/components/v3/datasets/value-actions'
import type { DatasetValueFlag } from '#/lib/dataset-flags'
import { screenQueryClient } from './screen-stories'

const noop = () => {}

const base = {
  datasetId: '0198d970-e266-4000-8000-000000000d01',
  rowId: '0198d970-e266-4000-8000-0000000r0001',
  fieldId: 'field-viability',
  fieldLabel: 'Viability',
  value: 118.4,
  onChanged: noop,
}

const sample = {
  id: '0198d970-e266-4000-8000-00000000smp1',
  identifier: 'SMP-2231',
}

/**
 * The selected-value actions (`src/components/v3/datasets/value-actions.tsx`).
 *
 * The same three actions wherever a dataset value is selected: mark it out of
 * range, clear the flag on it, or request a repeat. A manual flag and a
 * rule-derived (`system`) one can sit on the same value, so each is shown and
 * cleared separately — the system one through a dialog that records why a
 * reviewer dismissed the rule.
 *
 * The caller owns permission gating, so the read-only state is a story rather
 * than an assumption: a viewer sees the flags and no controls.
 */
const meta = {
  title: 'Datasets/Selected value actions',
  component: ValueActions,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={screenQueryClient()}>
        <div className="w-[460px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  parameters: { layout: 'centered' },
  // The dialog stories below render their own component; these are the props
  // the meta's component needs so a story without its own args still types.
  args: { ...base, canWrite: true },
} satisfies Meta<typeof ValueActions>
export default meta
type Story = StoryObj<typeof meta>

/** A value nothing is wrong with: flag it, or ask for a repeat from its sample. */
export const Unflagged: Story = {
  args: { ...base, canWrite: true, sourceSample: sample },
}

/** A value with no linked source sample: the repeat action says why it is off. */
export const NoSourceSample: Story = {
  args: { ...base, canWrite: true, sourceSample: null },
}

/** A person's own flag: the kind, the reason they gave and who set it. */
export const ManuallyFlagged: Story = {
  args: {
    ...base,
    canWrite: true,
    sourceSample: sample,
    flags: [
      {
        id: 'flag-1',
        datasetId: base.datasetId,
        rowId: base.rowId,
        fieldId: base.fieldId,
        kind: 'out_of_range',
        source: 'manual',
        reason: "Above the assay's validated range",
        comment: 'Re-read at 600 nm before the next run.',
        setAt: '2026-10-14T09:12:00.000Z',
      },
    ],
  },
}

/**
 * A rule-derived flag, with what the rule saw: a manual and a system flag can
 * sit on one value, so both are listed and each is cleared on its own.
 */
export const RuleFlagged: Story = {
  args: {
    ...base,
    canWrite: true,
    sourceSample: sample,
    flags: [
      {
        id: 'flag-2',
        datasetId: base.datasetId,
        rowId: base.rowId,
        fieldId: base.fieldId,
        kind: 'out_of_range',
        source: 'system',
        systemRule: 'out_of_range',
        reason: 'Outside the accepted range for this assay',
        comment: null,
        evaluatedValue: 118.4,
        threshold: { min: 60, max: 110 },
        evaluatedAt: '2026-10-14T08:00:00.000Z',
        setAt: '2026-10-14T08:00:00.000Z',
      },
      {
        id: 'flag-3',
        datasetId: base.datasetId,
        rowId: base.rowId,
        fieldId: base.fieldId,
        kind: 'high_cv',
        source: 'system',
        systemRule: 'high_cv',
        reason: 'Replicates disagree',
        comment: null,
        evaluatedValue: 21.4,
        threshold: { cvPercent: 21.4, replicateCount: 3, maxCvPercent: 15 },
        evaluatedAt: '2026-10-14T08:00:00.000Z',
        setAt: '2026-10-14T08:00:00.000Z',
      },
    ],
  },
}

/** A viewer: the flags are readable, the actions are not offered. */
export const ReadOnly: Story = {
  args: {
    ...base,
    canWrite: false,
    sourceSample: sample,
    flags: [
      {
        id: 'flag-4',
        datasetId: base.datasetId,
        rowId: base.rowId,
        fieldId: base.fieldId,
        kind: 'missing_unit',
        source: 'manual',
        reason: 'No unit recorded',
        comment: null,
        setAt: '2026-10-13T15:40:00.000Z',
      },
    ],
  },
}

/** The flag dialog: reason category required, comment optional. */
export const MarkOutOfRange: Story = {
  render: () => (
    <MarkOutOfRangeDialog
      open
      onOpenChange={noop}
      fieldLabel={base.fieldLabel}
      value={base.value}
      onSubmit={noop}
    />
  ),
}

/** Clearing a rule's flag is an override, so it records the reason. */
export const ClearSystemFlag: Story = {
  render: () => (
    <ClearSystemFlagDialog
      open
      onOpenChange={noop}
      flagLabel="Out of range"
      onSubmit={noop}
    />
  ),
}

/** The same two dialogs mid-write: every control is held while it is pending. */
export const DialogsBusy: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <MarkOutOfRangeDialog
        open
        onOpenChange={noop}
        fieldLabel={base.fieldLabel}
        value={base.value}
        busy
        onSubmit={noop}
      />
    </div>
  ),
}

/** A value with no reading at all: the em dash the inspector shows. */
export const NoValue: Story = {
  args: { ...base, value: null, canWrite: true, sourceSample: null },
}

const flag = (overrides: Partial<DatasetValueFlag> = {}): DatasetValueFlag => ({
  id: 'flag-x',
  datasetId: base.datasetId,
  rowId: base.rowId,
  fieldId: base.fieldId,
  kind: 'out_of_range',
  reason: 'Out of range',
  comment: null,
  setAt: '2026-10-14T09:12:00.000Z',
  ...overrides,
})

/** Every flag kind the component can label, in one column. */
export const EveryFlagKind: Story = {
  args: {
    ...base,
    canWrite: true,
    sourceSample: sample,
    flags: [
      flag({ id: 'k1', kind: 'out_of_range' }),
      flag({ id: 'k2', kind: 'missing_unit' }),
      flag({ id: 'k3', kind: 'above_curve' }),
      flag({ id: 'k4', kind: 'high_cv' }),
    ],
  },
}
