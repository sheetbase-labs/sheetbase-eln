import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { screen, userEvent } from 'storybook/test'

import {
  QuantityKeypad,
  ReserveDialog,
  WithdrawDialog,
} from '#/components/v3/samples/withdraw-dialog'
import type { ExperimentOption } from '#/components/v3/samples/withdraw-dialog'
import type { SampleQuantityBalances } from '#/lib/samples'
import { screenQueryClient } from './screen-stories'

/**
 * LAB-01 step 3 — the withdraw / reserve dialogs and their keypad
 * (`src/components/v3/samples/withdraw-dialog.tsx`).
 *
 * The dialogs own their reads only when the caller does not pass the data, so
 * these stories pass the workspace's experiments and the authoritative balance
 * as props: that is the state the Usage tab renders, and it keeps every read
 * static. The plays type the overdraw the server would refuse so the inline
 * refusal is shown, not just the empty form.
 */
const SAMPLE = {
  id: '0198d970-e266-4000-8000-0000000005a1',
  identifier: 'SMP-2231',
  title: 'Harvest lot HL-0934',
  quantity: 4600,
  quantityUnit: 'mL',
}

const EXPERIMENTS: ExperimentOption[] = [
  { id: 'exp-1', identifier: 'EXP-0142', title: 'Depth filtration' },
  { id: 'exp-2', identifier: 'EXP-0147', title: 'Virus inactivation' },
]

const BALANCES: SampleQuantityBalances = {
  sampleRecordId: SAMPLE.id,
  unit: 'mL',
  current: 4600,
  used: 10400,
  reserved: 3000,
  free: 1600,
}

const meta = {
  title: 'Samples/Withdraw and reserve',
  decorators: [
    (Story) => (
      <QueryClientProvider client={screenQueryClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The dialog as the Usage tab opens it: 1,600 mL free of 15,000 mL registered. */
export const Withdraw: Story = {
  render: () => (
    <WithdrawDialog
      open
      onOpenChange={() => {}}
      sample={SAMPLE}
      busy={false}
      onSubmit={() => {}}
      experiments={EXPERIMENTS}
      balances={BALANCES}
    />
  ),
}

/** An amount above the free balance is refused in the dialog before any write. */
export const WithdrawOverFree: Story = {
  render: () => (
    <WithdrawDialog
      open
      onOpenChange={() => {}}
      sample={SAMPLE}
      busy={false}
      onSubmit={() => {}}
      experiments={EXPERIMENTS}
      balances={BALANCES}
    />
  ),
  play: async () => {
    await userEvent.type(await screen.findByLabelText(/Volume/), '2000')
    await screen.findByText('Only 1,600 mL left. Enter 1,600 or less.')
  },
}

/** A valid amount states what will remain; choosing a purpose enables the action. */
export const WithdrawReady: Story = {
  render: () => (
    <WithdrawDialog
      open
      onOpenChange={() => {}}
      sample={SAMPLE}
      busy={false}
      onSubmit={() => {}}
      experiments={EXPERIMENTS}
      balances={BALANCES}
    />
  ),
  play: async () => {
    await userEvent.type(await screen.findByLabelText(/Volume/), '600')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /Purpose/ }),
      'exp-1',
    )
    await screen.findByText('1,000 mL will be left')
  },
}

/** No active experiments: the picker says so rather than offering a dead end. */
export const WithdrawNoExperiments: Story = {
  render: () => (
    <WithdrawDialog
      open
      onOpenChange={() => {}}
      sample={SAMPLE}
      busy={false}
      onSubmit={() => {}}
      experiments={[]}
      balances={BALANCES}
    />
  ),
}

/** The reserve dialog uses the same balance and gate, with free rather than left. */
export const Reserve: Story = {
  render: () => (
    <ReserveDialog
      open
      onOpenChange={() => {}}
      sample={SAMPLE}
      busy={false}
      onSubmit={() => {}}
      experiments={EXPERIMENTS}
      balances={BALANCES}
    />
  ),
}

export const ReserveOverFree: Story = {
  render: () => (
    <ReserveDialog
      open
      onOpenChange={() => {}}
      sample={SAMPLE}
      busy={false}
      onSubmit={() => {}}
      experiments={EXPERIMENTS}
      balances={BALANCES}
    />
  ),
  play: async () => {
    await userEvent.type(await screen.findByLabelText(/Volume/), '2000')
    await screen.findByText('Only 1,600 mL free. Enter 1,600 or less.')
  },
}

/** The numeric keypad the dialogs show in place of the keyboard on narrow screens. */
export const Keypad: Story = {
  render: () => (
    <div className="w-[260px]">
      <QuantityKeypad onKey={() => {}} />
    </div>
  ),
}
