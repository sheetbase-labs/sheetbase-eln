import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  GateBlockView,
  GateDialog,
  GatesProvider,
  LockedPartBanner,
} from '#/components/notebook/gates'
import type { GatesState } from '#/components/notebook/gates'
import type { RecordGate } from '#/lib/experiment-gates'

/**
 * Gates between the parts of an experiment: a bar that says what has to be done
 * first, a part that is not open yet, and the dialog that sets the rule.
 */
const gate = (extra: Partial<RecordGate> = {}): RecordGate => ({
  gateId: 'block:g1',
  kind: 'block',
  blockId: 'g1',
  partId: null,
  partNumber: null,
  label: 'Confluence check',
  mode: 'block',
  met: false,
  blocking: true,
  overridden: false,
  overriddenAt: null,
  overriddenByUserId: null,
  overrideReason: null,
  missing: ['A2 and A3 have no Confluence (%)'],
  conditions: [
    {
      kind: 'table_filled',
      met: false,
      soft: false,
      text: 'A2 and A3 have no Confluence (%)',
      blockId: 't1',
    },
  ],
  fromTemplate: false,
  ...extra,
})

function state(gates: RecordGate[]): GatesState {
  return {
    recordId: 'r1',
    gates,
    held: new Map(),
    stepWaits: new Map(),
    canEdit: true,
    describeOnly: false,
    context: {
      blocks: [
        {
          id: 't1',
          type: 'table',
          order: 1,
          payload: {
            title: 'Confluence check',
            columns: ['Well', 'Confluence (%)'],
          },
        },
      ],
      parts: [],
    },
    nameOf: () => 'Priya Shah',
    goOn: () => {},
    edit: () => {},
    show: () => {},
    targetsFor: () => ({ tables: [], steps: [], parts: [] }),
  }
}

const payload = {
  label: 'Confluence check',
  mode: 'block',
  conditions: [
    { kind: 'table_filled', blockId: 't1', column: 'Confluence (%)' },
  ],
}

const meta = {
  title: 'Notebook/Gates',
  component: GateBlockView,
  tags: ['autodocs'],
  args: { blockId: 'g1', payload },
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GateBlockView>
export default meta
type Story = StoryObj<typeof meta>

export const Blocking: Story = {
  decorators: [
    (Story) => (
      <GatesProvider value={state([gate()])}>
        <Story />
      </GatesProvider>
    ),
  ],
}

export const Warning: Story = {
  args: { payload: { ...payload, mode: 'warn' } },
  decorators: [
    (Story) => (
      <GatesProvider value={state([gate({ mode: 'warn', blocking: false })])}>
        <Story />
      </GatesProvider>
    ),
  ],
}

export const Open: Story = {
  decorators: [
    (Story) => (
      <GatesProvider
        value={state([gate({ met: true, blocking: false, missing: [] })])}
      >
        <Story />
      </GatesProvider>
    ),
  ],
}

export const WentOnAnyway: Story = {
  decorators: [
    (Story) => (
      <GatesProvider
        value={state([
          gate({
            blocking: false,
            mode: 'warn',
            overridden: true,
            overriddenByUserId: 'u1',
            overrideReason: 'Plates were read on the other reader.',
          }),
        ])}
      >
        <Story />
      </GatesProvider>
    ),
  ],
}

export const PartNotOpen: Story = {
  render: () => (
    <LockedPartBanner
      gate={gate({
        kind: 'part',
        partId: 'p4',
        partNumber: 4,
        mode: 'block',
        missing: ['Part 3 (Dose) isn’t done'],
      })}
      goToPart={{ number: 3, onClick: () => {} }}
    />
  ),
}

export const SettingTheRule: Story = {
  render: () => (
    <GateDialog
      part={4}
      named={false}
      canStepsInOrder
      targets={{
        tables: [],
        steps: [],
        parts: [{ id: 'p3', number: 3, title: 'Dose' }],
      }}
      onSave={() => {}}
      onClose={() => {}}
    />
  ),
}
