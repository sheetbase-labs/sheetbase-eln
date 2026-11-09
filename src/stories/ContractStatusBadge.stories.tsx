import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ContractStatusBadge } from '#/components/contracts/contract-status'

/**
 * Where a dataset or model stands against its data contract: Pass, Warning or
 * Fail, or "Not checked" before the first check. Colour sits in the dot, so the
 * word still carries the meaning in greyscale.
 */
const meta = {
  title: 'Contracts/ContractStatusBadge',
  component: ContractStatusBadge,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { status: 'pass' },
} satisfies Meta<typeof ContractStatusBadge>

export default meta

type Story = StoryObj<typeof meta>

export const Pass: Story = {}
export const Warning: Story = { args: { status: 'warning' } }
export const Fail: Story = { args: { status: 'fail' } }
export const NotChecked: Story = { args: { status: null } }
