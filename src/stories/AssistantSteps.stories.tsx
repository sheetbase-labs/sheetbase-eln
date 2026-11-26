import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { StepList, stepCallOf } from '#/components/assist/chat/steps'

/**
 * The assistant's step list: what each lookup did, in words, with the records
 * it named. Searches that follow each other read as one line that opens to show
 * each one, and a failed step says what it could not do and why.
 */
const meta = {
  title: 'Assistant/StepList',
  component: StepList,
  tags: ['autodocs'],
} satisfies Meta<typeof StepList>

export default meta

type Story = StoryObj<typeof meta>

const found = (query: string, refs: string[]) =>
  stepCallOf({
    toolName: 'sheetbase.search',
    input: { query },
    state: 'output-available',
    output: { ok: true, refs },
  })

export const MergedSearches: Story = {
  args: {
    calls: [
      found('PicoGreen', ['MAT-0419', 'EXP-0123']),
      found('PicoGreen kit', ['MAT-0418']),
      stepCallOf({
        toolName: 'sheetbase.protocol.read',
        input: { query: 'PicoGreen' },
        state: 'output-available',
      }),
    ],
  },
}

export const FailedAndRunning: Story = {
  args: {
    calls: [
      stepCallOf({
        toolName: 'sheetbase.templates.read',
        input: { template: 'T-12' },
        state: 'output-error',
        errorText: 'Template not found.',
      }),
      stepCallOf({
        toolName: 'sheetbase.steps.read',
        input: { record: 'EXP-0123' },
        state: 'input-available',
      }),
    ],
  },
}
