import { describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'

import { runStudiesAction } from './assistant-studies-run'
import type { DataClient } from './data-client'

/** What each named RPC answers in a test; the action reads only the fields it needs. */
type RpcAnswers = Readonly<Record<string, z.core.util.JSONType | undefined>>

function client(answers: RpcAnswers = {}) {
  const rpc = vi.fn(
    async (name: string, _args?: Record<string, z.core.util.JSONType>) =>
      answers[name] ?? {},
  )

  // SAFETY: The runner only issues the RPCs the answers cover; no other DataClient method is reached.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The double implements `rpc` alone, so neither it nor the interface is assignable to the other.
  return { client: { rpc } as unknown as DataClient, rpc }
}

describe('running a planning card', () => {
  it('edits a task, then moves its date from the version the edit left', async () => {
    const { client: c, rpc } = client({
      edit_study_task: { metadata_version: 5 },
    })

    await runStudiesAction(c, {
      kind: 'study.task_update',
      taskId: 't1',
      expectedMetadataVersion: 4,
      edit: { status: 'in_progress' },
      move: { dueAt: '2026-12-08T12:00:00Z', reason: 'Rerun' },
    })
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      'edit_study_task',
      'move_study_task_due',
    ])
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_task_id: 't1',
      p_status: 'in_progress',
      p_expected_metadata_version: 4,
    })
    expect(rpc.mock.calls[1][1]).toMatchObject({
      p_expected_metadata_version: 5,
      p_reason: 'Rerun',
    })
  })

  it('adds a task in the workspace of the card and opens the planner', async () => {
    const { client: c, rpc } = client({
      create_study_task: { id: 't2', project_id: 'p1' },
    })

    const result = await runStudiesAction(c, {
      kind: 'study.task_add',
      workspaceId: 'ws-1',
      title: 'Sign off',
      taskType: 'task',
      projectId: 'p1',
      dueAt: null,
      priority: null,
      description: null,
    })

    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_workspace_id: 'ws-1',
      p_title: 'Sign off',
    })
    expect(result).toEqual({ openHref: '/projects/p1/milestones' })
  })

  it('generates a report and archives a design', async () => {
    const { client: c, rpc } = client({
      generate_report: {
        id: 'g1',
        report_id: 'r1',
        report_version: 1,
        output_format: 'html',
        output_checksum: 'x',
        output_size_bytes: 1,
        actor_user_id: 'u',
        generated_at: '2026-11-09T00:00:00Z',
      },
    })

    expect(
      await runStudiesAction(c, {
        kind: 'report.generate',
        workspaceId: 'ws-1',
        reportId: 'r1',
      }),
    ).toEqual({ openHref: '/reports/r1' })
    await runStudiesAction(c, {
      kind: 'plate_design.archive',
      designId: 'd1',
      expectedMetadataVersion: 2,
    })
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      'generate_report',
      'archive_plate_design',
    ])
  })
})
