import { describe, expect, it } from 'vitest'

import type { ApprovalRequest } from '#/lib/approval-requests'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'
import { buildActivity } from './activity-events'

const version = (
  over: Partial<PipelineDefinitionVersionWire>,
): PipelineDefinitionVersionWire => ({
  id: 'v',
  definition_id: 'd',
  workspace_id: 'w',
  version: 1,
  lifecycle: 'draft',
  configuration_format_version: 2,
  configuration: {},
  revision: 1,
  created_at: '2026-11-01T09:00:00Z',
  updated_at: '2026-11-01T09:00:00Z',
  created_by_user_id: 'u1',
  published_at: null,
  published_by_user_id: null,
  retired_at: null,
  retired_by_user_id: null,
  ...over,
})

const request = (over: Partial<ApprovalRequest>): ApprovalRequest => ({
  id: 'r1',
  workspace_id: 'w',
  object_kind: 'pipeline_definition_version',
  object_id: 'v2',
  object_revision: 1,
  required_approver_roles: ['admin', 'owner'],
  required_approvals: 1,
  require_independence: true,
  state: 'pending',
  reason: 'Tighter limits',
  decision_reason: null,
  approved_by_user_ids: [],
  submitted_by_user_id: 'u1',
  submitted_at: '2026-11-05T10:00:00Z',
  decided_by_user_id: null,
  decided_at: null,
  created_at: '2026-11-05T10:00:00Z',
  updated_at: '2026-11-05T10:00:00Z',
  ...over,
})

describe('buildActivity', () => {
  it('lists drafts, requests, decisions and publishing, newest first', () => {
    const events = buildActivity(
      [
        version({
          id: 'v1',
          version: 1,
          lifecycle: 'retired',
          published_at: '2026-11-02T09:00:00Z',
          published_by_user_id: 'u2',
          retired_at: '2026-11-06T09:00:00Z',
          retired_by_user_id: 'u2',
        }),
        version({
          id: 'v2',
          version: 2,
          created_at: '2026-11-05T09:00:00Z',
          lifecycle: 'published',
          published_at: '2026-11-06T09:00:00Z',
          published_by_user_id: 'u1',
        }),
      ],
      [
        request({
          state: 'approved',
          decided_by_user_id: 'u2',
          decided_at: '2026-11-06T09:00:00Z',
        }),
      ],
      [
        {
          id: 'd1',
          request_id: 'r1',
          workspace_id: 'w',
          user_id: 'u2',
          role: 'admin',
          decision: 'approved',
          reason: null,
          created_at: '2026-11-06T09:00:00Z',
        },
      ],
    )

    expect(events.map((e) => `${e.kind}:v${e.version}`)).toEqual([
      'retired:v1',
      'published:v2',
      'approved:v2',
      'requested:v2',
      'created:v2',
      'published:v1',
      'created:v1',
    ])

    expect(events.find((e) => e.kind === 'requested')?.note).toBe(
      'Tighter limits',
    )
  })

  it('ignores requests for versions of another pipeline', () => {
    const events = buildActivity(
      [version({ id: 'v1' })],
      [request({ object_id: 'elsewhere' })],
      [],
    )

    expect(events.map((e) => e.kind)).toEqual(['created'])
  })
})
