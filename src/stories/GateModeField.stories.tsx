import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { GateModeField } from '#/components/settings/gate-mode-field'

/** The block, warn or off picker the workspace gate settings share. */
const options = [
  { value: 'block', label: 'Block', hint: 'The action is refused.' },
  { value: 'warn', label: 'Warn', hint: 'It is listed and goes through.' },
  { value: 'off', label: 'Off', hint: 'It is not checked.' },
] as const

const meta = {
  title: 'Settings/Gate mode field',
  component: GateModeField,
  args: {
    label: 'Before submission',
    options,
    mode: 'warn',
    disabled: false,
    onPick: () => {},
  },
} satisfies Meta<typeof GateModeField>

export default meta

type Story = StoryObj<typeof meta>

export const Warn: Story = {}

export const Block: Story = { args: { mode: 'block' } }

export const ReadOnly: Story = { args: { disabled: true } }
