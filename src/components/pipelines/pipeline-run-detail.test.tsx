import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { DataClient } from '#/lib/data-client'
import type { PipelineRunLogWire } from '#/lib/pipelines/types'
import {
  PipelineActionResults,
  PipelineLogDetails,
  PipelineRunDetail,
} from './pipeline-run-detail'

const projectId = '00000000-0000-4000-8000-000000000111'
const recordId = '00000000-0000-4000-8000-000000000112'
const logs: PipelineRunLogWire[] = [
  {
    id: 'log',
    workspace_id: 'workspace',
    run_id: 'run',
    sequence: 1,
    level: 'info',
    stage: 'action',
    message: 'project completed',
    detail: { name: 'project', operation: 'create_project' },
    at: '2026-09-07T12:00:00Z',
  },
]
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
  }: {
    to: string
    params?: Record<string, string>
    children: ReactNode
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (href, [key, value]) => href.replace(`$${key}`, value),
        to,
      )}
    >
      {children}
    </a>
  ),
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey.at(-1) === 'logs'
        ? logs
        : queryKey.at(-1) === 'outputs'
          ? []
          : {
              status: 'succeeded',
              trigger_kind: 'manual',
              attempt: 1,
              started_at: '2026-09-07T12:00:00Z',
              input_versions: {},
              parameters: {},
              result: { notificationDeliveryIds: ['one', 'two'] },
            },
    isLoading: false,
    isError: false,
  }),
}))
afterEach(cleanup)
it('links canonical records and confirmed project results, while leaving unknown ids as facts', () => {
  render(
    <PipelineActionResults
      actions={{
        project: { id: projectId, key: 'study', title: 'Study workspace' },
        sample: {
          id: recordId,
          kind: 'sample',
          project_id: projectId,
          identifier: 'SMP-001',
          title: 'Retention sample',
        },
        unknown: { id: projectId, title: 'Unclassified result', count: 4 },
      }}
      logs={logs}
    />,
  )
  expect(
    screen.getByRole('link', { name: 'Study workspace' }).getAttribute('href'),
  ).toBe(`/projects/${projectId}`)
  expect(
    screen.getByRole('link', { name: 'Retention sample' }).getAttribute('href'),
  ).toBe(`/records/${recordId}`)
  expect(screen.getByText('SMP-001')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Unclassified result' })).toBeNull()
  expect(screen.getByText(/"count": 4/)).toBeTruthy()
})
it('retains multiline Python print output and runtime in a closed disclosure', () => {
  const { container } = render(
    <PipelineLogDetails
      detail={{
        runtime: 'python@sha256:abc',
        logs: ['Loaded 24 rows', 'Mean concentration: 7.5\nComplete'],
      }}
    />,
  )
  expect(container.querySelector('details')?.open).toBe(false)
  expect(container.querySelector('pre')?.textContent).toBe(
    'Loaded 24 rows\nMean concentration: 7.5\nComplete',
  )
  expect(screen.getByText('python@sha256:abc')).toBeTruthy()
})
it('shows queued notifications with a separate delivery-tracking link', () => {
  render(<PipelineRunDetail dataClient={{} as DataClient} runId="run" />)
  expect(screen.getByText('2 notifications queued')).toBeTruthy()
  expect(
    screen
      .getByRole('link', { name: 'View webhook deliveries' })
      .getAttribute('href'),
  ).toBe('/admin/webhooks')
  expect(screen.getByText(/Delivery is tracked separately/)).toBeTruthy()
})
