import { createElement } from 'react'
import { cleanup, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { pipelineRun, renderPipeline } from './test-support'
import { pipelineDataQueryKeys } from './pipelines-data'

import { ScheduleHistoryDialog } from './schedule-history'
import type {
  PipelineScheduleWire,
  PipelineRunWire,
  PipelineScheduleActivityWire,
} from '#/lib/pipelines/types'

interface HistoryState {
  runs: PipelineRunWire[]
  activity: PipelineScheduleActivityWire[]
}

const state: HistoryState = { runs: [], activity: [] }

const schedule: PipelineScheduleWire = {
  id: 'sched-1',
  input_watermarks: {},
  workspace_id: 'ws-1',
  definition_id: 'p-1',
  kind: 'daily',
  spec: { dailyAt: '06:00', timeZone: 'UTC' },
  enabled: true,
  last_run_at: null,
  next_run_at: null,
  last_evaluated_at: null,
  last_evaluated_sequence: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  created_by_user_id: null,
}

afterEach(() => {
  cleanup()
  state.runs = []
  state.activity = []
})

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity } },
  })

  client.setQueryData(
    pipelineDataQueryKeys.scheduleRuns(schedule.id),
    state.runs,
  )
  client.setQueryData(
    pipelineDataQueryKeys.scheduleActivity(schedule.id),
    state.activity,
  )
  renderPipeline(
    createElement(ScheduleHistoryDialog, {
      open: true,
      onOpenChange: () => {},
      schedule,
      title: 'Daily at 06:00 (UTC)',
    }),
    client,
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
      pipelineRun({
        id: 'run-1',
        status: 'succeeded',
        attempt: 1,
        started_at: '2026-10-21T06:00:00.000Z',
        finished_at: '2026-10-21T06:00:03.000Z',
      }),
      pipelineRun({
        id: 'run-2',
        status: 'failed',
        attempt: 2,
        started_at: '2026-10-20T06:00:00.000Z',
        finished_at: null,
      }),
    ]
    show()

    expect(screen.getByText('Succeeded')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText('Retry 2')).toBeTruthy()
    expect(
      screen.getAllByRole('link').map((link) => link.getAttribute('href')),
    ).toEqual(['/pipelines/runs/run-1', '/pipelines/runs/run-2'])
  })

  it('explains each time it chose not to run, counting repeats', () => {
    state.activity = [
      {
        id: 'a1',
        schedule_id: schedule.id,
        occurrence_id: null,
        kind: 'skipped_unchanged',
        message:
          'No new Dataset Version since the last run, so nothing was run.',
        detail: { count: 6 },
        occurred_at: '2026-10-21T06:00:00.000Z',
      },
      {
        id: 'a2',
        schedule_id: schedule.id,
        occurrence_id: null,
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
