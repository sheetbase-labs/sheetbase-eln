import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { ReviewCheckResults } from '#/components/review/review-check-results'

const base: any = {
  overall_status: 'warning',
  pass_count: 2,
  blocking_failure_count: 0,
  warning_failure_count: 1,
  info_failure_count: 0,
  check_definition_key: 'experiment-submission',
  check_definition_version: 3,
  revision_integrity_digest: '4c9620bbd4f931955d4d42820a77fa9d',
  results: [
    {
      key: 'title',
      label: 'Experiment has a descriptive title',
      severity: 'blocking',
      status: 'pass',
      evidence: {},
    },
    {
      key: 'samples',
      label: 'All sample links resolve',
      severity: 'blocking',
      status: 'pass',
      evidence: { resolved: 8, total: 8 },
    },
    {
      key: 'units',
      label: 'Measurements use canonical units',
      severity: 'warning',
      status: 'fail',
      evidence: { block: 'Results', value: 'mg/ml', expected: 'mg/mL' },
    },
  ],
}
const meta = {
  title: 'Review/Check results',
  component: ReviewCheckResults,
  tags: ['autodocs'],
  args: { result: base },
} satisfies Meta<typeof ReviewCheckResults>
export default meta
type Story = StoryObj<typeof meta>
export const Warning: Story = {}
export const Passed: Story = {
  args: {
    result: {
      ...base,
      overall_status: 'pass',
      pass_count: 3,
      warning_failure_count: 0,
      results: base.results.map((r: any) => ({ ...r, status: 'pass' })),
    },
  },
}
export const BlockingFailure: Story = {
  args: {
    result: {
      ...base,
      overall_status: 'fail',
      blocking_failure_count: 1,
      results: [
        ...base.results,
        {
          key: 'approval',
          label: 'Protocol approval is current',
          severity: 'blocking',
          status: 'fail',
          evidence: { protocol: 'PRT-2026-0012', status: 'draft' },
        },
      ],
    },
  },
}
