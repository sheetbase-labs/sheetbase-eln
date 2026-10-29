import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ScheduleHistoryDialog } from './schedule-history'
import type { PipelineScheduleWire } from '#/lib/pipelines/types'

const state = vi.hoisted(() => ({
  runs: [] as unknown[],
  activity: [] as unknown[],
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
  }: {
    children: React.ReactNode
    params?: { runId?: string }
  }) => createElement('a', { href: `/runs/${params?.runId}` }, children),
}))

vi.mock('#/components/v3/pipelines/pipelines-data', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useScheduleRuns: () => ({ data: state.runs, isLoading: false }),
  useScheduleActivity: () => ({ data: state.activity, isLoading: false }),
}))

const schedule = {
  id: 'sched-1',
  input_watermarks: {},
} as unknown as PipelineScheduleWire

afterEach(() => {
  cleanup()
  state.runs = []
  state.activity = []
})

function show() {
  render(
    createElement(ScheduleHistoryDialog, {
      open: true,
      onOpenChange: () => {},
      schedule,
      title: 'Daily at 06:00 (UTC)',
    }),
  )
}

describe('ScheduleHistoryDialog', () => {
  it('says so when a trigger has started nothing and skipped nothing', () => {
    show()
    expect(
      screen.getByText('This trigger hasn’t started a run yet.'),
    ).toBeTruthy()
    expect(screen.getByText('Nothing has been skipped')).toBeTruthy()
  })

  it('lists the runs it started and links each to its run', () => {
    state.runs = [
      {
        id: 'run-1',
        status: 'succeeded',
        attempt: 1,
        started_at: '2026-10-21T06:00:00.000Z',
        finished_at: '2026-10-21T06:00:03.000Z',
      },
      {
        id: 'run-2',
        status: 'failed',
        attempt: 2,
        started_at: '2026-10-20T06:00:00.000Z',
        finished_at: null,
      },
    ]
    show()

    expect(screen.getByText('Succeeded')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText('Retry 2')).toBeTruthy()
    expect(
      screen.getAllByRole('link').map((link) => link.getAttribute('href')),
    ).toEqual(['/runs/run-1', '/runs/run-2'])
  })

  it('explains each time it chose not to run, counting repeats', () => {
    state.activity = [
      {
        id: 'a1',
        kind: 'skipped_unchanged',
        message:
          'No new Dataset Version since the last run, so nothing was run.',
        detail: { count: 6 },
        occurred_at: '2026-10-21T06:00:00.000Z',
      },
      {
        id: 'a2',
        kind: 'skipped_missed',
        message:
          '2 scheduled runs were missed and skipped, as this trigger is set to.',
        detail: { count: 1, missed: 2 },
        occurred_at: '2026-10-20T06:00:00.000Z',
      },
    ]
    show()

    expect(screen.getByText('Nothing new')).toBeTruthy()
    expect(screen.getByText(/6 times/)).toBeTruthy()
    expect(screen.getByText('Missed and skipped')).toBeTruthy()
    expect(screen.getByText(/2 scheduled runs were missed/)).toBeTruthy()
  })
})
