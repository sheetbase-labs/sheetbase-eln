import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { IntakeProblems } from '#/components/v3/integrations/intake-problems'
import { intakeQueryKeys } from '#/lib/connectors/intake-client'
import type { IntakeProblem } from '#/lib/connectors/intake-client'
import { screenQueryClient } from './screen-stories'

/**
 * Files an instrument sent that couldn’t be read, on the instrument’s page: the
 * file, the reason in a few words (the full text in the tooltip), and what a
 * person can do about it.
 */
const meta = {
  title: 'Instruments/Intake problems',
  decorators: [
    (Story) => (
      <div className="w-[880px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const problems: IntakeProblem[] = [
  {
    id: 'problem-1',
    connector_id: 'connector-tb02',
    instrument_id: 'instrument-tb02',
    file_name: 'TB02_fw4_2026-09-25_1002.csv',
    source: 'agent',
    code: 'parser_unrecognised',
    message:
      'The file doesn’t have the columns TB-02 CSV needs (sample, turbidity, dilution).',
    parser_key: 'tb_02_csv',
    file_record_id: 'file-1',
    attempts: 1,
    created_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    last_attempt_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
]

function provider(rows: IntakeProblem[]) {
  const client = screenQueryClient({
    data: [{ key: intakeQueryKeys.problems('instrument-tb02'), value: rows }],
  })
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

export const OneProblem: Story = {
  decorators: [provider(problems)],
  render: () => (
    <IntakeProblems
      workspaceId="workspace-1"
      instrumentId="instrument-tb02"
      canManage
    />
  ),
}
