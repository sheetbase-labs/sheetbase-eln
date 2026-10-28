import { describe, expect, it } from 'vitest'

import { itemLink } from './destination'
import type { WorkItem, WorkItemKind } from './data'

function item(kind: WorkItemKind, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    kind,
    recordId: 'record-1',
    identifier: 'EXP-1',
    title: 'A record',
    projectId: 'project-1',
    reason: 'Because',
    dueAt: null,
    state: 'needs_action',
    createdAt: null,
    ...overrides,
  }
}

describe('itemLink', () => {
  it('opens an expiring material on its actual lot page, with a registry fallback only when identity is absent', () => {
    expect(itemLink(item('material_expiring'))).toEqual({
      to: '/materials/$lotId',
      params: { lotId: 'record-1' },
    })
    expect(itemLink(item('material_expiring', { recordId: null }))).toEqual({
      to: '/materials',
    })
  })

  it('opens the exact live flagged value, not the dataset with the most issues', () => {
    expect(
      itemLink(
        item('data_issue', {
          recordId: null,
          datasetId: 'dataset-b',
          rowId: 'row-903',
          fieldId: 'titre',
          sourceType: 'dataset_value_flag',
          sourceId: 'flag-3',
        }),
      ),
    ).toEqual({
      to: '/datasets/$datasetId/rows',
      params: { datasetId: 'dataset-b' },
      search: { row: 'row-903', field: 'titre', live: true },
    })
  })

  it('opens a review request on the exact revision under review', () => {
    expect(itemLink(item('review_requested', { revisionId: 'rev-1' }))).toEqual(
      { to: '/review/$revisionId', params: { revisionId: 'rev-1' } },
    )
  })

  it('falls back to the record when a review request names no revision', () => {
    expect(itemLink(item('review_requested'))).toEqual({
      to: '/records/$recordId',
      params: { recordId: 'record-1' },
    })
  })

  it('opens an approval that is waiting for a signature with the signing meaning chosen', () => {
    expect(
      itemLink(item('approval_unsigned', { revisionId: 'rev-2' })),
    ).toEqual({
      to: '/review/$revisionId',
      params: { revisionId: 'rev-2' },
      search: { signatureMeaning: 'reviewed-and-approved' },
    })
  })

  it('opens a returned review on the record, where the banner and resubmit are', () => {
    expect(itemLink(item('review_returned', { revisionId: 'rev-3' }))).toEqual({
      to: '/records/$recordId',
      params: { recordId: 'record-1' },
    })
  })

  it('opens a witness signature on its review', () => {
    expect(itemLink(item('witness_signed', { revisionId: 'rev-4' }))).toEqual({
      to: '/review/$revisionId',
      params: { revisionId: 'rev-4' },
    })
  })

  it('opens access requests where they are decided and decisions on the project', () => {
    expect(itemLink(item('access_requested', { recordId: null }))).toEqual({
      to: '/settings/access',
    })
    expect(itemLink(item('access_decided', { recordId: null }))).toEqual({
      to: '/projects/$projectId',
      params: { projectId: 'project-1' },
    })
  })

  it('opens an agent proposal on that proposal', () => {
    expect(
      itemLink(item('agent_proposal', { recordId: null, sourceId: 'prop-1' })),
    ).toEqual({
      to: '/pipelines/agents',
      search: { view: 'proposals', proposal: 'prop-1' },
    })
  })

  it('opens identity verification, on either side, on the signature settings', () => {
    expect(
      itemLink(item('verification_requested', { recordId: null })),
    ).toEqual({ to: '/settings/my-signature' })
    expect(itemLink(item('verification_granted', { recordId: null }))).toEqual({
      to: '/settings/my-signature',
    })
  })

  it('opens an accepted invitation on the members list', () => {
    expect(itemLink(item('invitation_accepted', { recordId: null }))).toEqual({
      to: '/settings/members',
    })
  })

  it('opens a sample on the sample page and an instrument on its own page', () => {
    expect(itemLink(item('sample_awaiting_release'))).toEqual({
      to: '/samples/$sampleId',
      params: { sampleId: 'record-1' },
    })
    expect(itemLink(item('sample_hold_exceeded'))).toEqual({
      to: '/samples/$sampleId',
      params: { sampleId: 'record-1' },
    })
    expect(
      itemLink(
        item('calibration_overdue', { recordId: null, sourceId: 'inst-1' }),
      ),
    ).toEqual({
      to: '/instruments/$instrumentId',
      params: { instrumentId: 'inst-1' },
    })
    for (const kind of ['qualification_requested', 'qualification_granted'])
      expect(
        itemLink(item(kind as 'calibration_overdue', { sourceId: 'inst-1' })),
      ).toEqual({
        to: '/instruments/$instrumentId',
        params: { instrumentId: 'inst-1' },
      })
  })
})
