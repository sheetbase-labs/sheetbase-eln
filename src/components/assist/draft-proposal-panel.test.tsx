/**
 * DraftProposalPanel tests (ASSIST-02). Every proposal renders
 * preview-before-commit: a marked-generated banner, the preview, and
 * Accept/Discard. The panel never mutates — Accept and
 * Discard only call the host callbacks, and Discard leaves zero state.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { proposeChartSpec, suggestMappingProposal } from '#/lib/assist-drafts'
import type { AssistDraftProposal } from '#/lib/assist-drafts'
import type { ImportTargetField } from '#/lib/import-mapping'

import { DraftProposalPanel } from './draft-proposal-panel'

afterEach(cleanup)

const DATASET_ID = '11111111-1111-4111-8111-111111111111'

function mappingProposal(): AssistDraftProposal {
  const fields: ImportTargetField[] = [
    {
      id: 'organism',
      key: 'organism',
      label: 'Organism',
      logicalType: 'text',
      nullable: false,
      kind: 'record-field',
    },
  ]
  return suggestMappingProposal(['Organism', 'zzz_unmatched'], fields)
}

function chartProposal(): AssistDraftProposal {
  const proposal = proposeChartSpec({
    datasetId: DATASET_ID,
    fields: [
      {
        fieldId: '22222222-2222-4222-8222-222222222222',
        label: 'Temperature',
        logicalType: 'number',
      },
    ],
  })
  if (!proposal) throw new Error('fixture proposal must build')
  return proposal
}

describe('DraftProposalPanel', () => {
  it.each([
    ['import mapping', mappingProposal],
    ['chart config', chartProposal],
  ])(
    'marks a %s proposal as generated without exposing grounding',
    (_label, build) => {
      render(
        <DraftProposalPanel
          proposal={build()}
          onAccept={() => {}}
          onDiscard={() => {}}
        />,
      )
      expect(screen.getByRole('note', { name: 'Generated draft' })).toBeTruthy()
      expect(screen.getByText(/Not authoritative/)).toBeTruthy()
      // No model provider exists yet — the cited-source grounding an LLM
      // would consume is prompt material, not user-facing content.
      expect(screen.queryByText(/Cited sources/)).toBeNull()
    },
  )

  it('previews per-column confidence for a mapping proposal', () => {
    render(
      <DraftProposalPanel
        proposal={mappingProposal()}
        onAccept={() => {}}
        onDiscard={() => {}}
      />,
    )
    expect(screen.getByText(/Mapping preview/)).toBeTruthy()
    expect(screen.getByText(/\[exact\]/)).toBeTruthy()
    expect(screen.getByText(/\[none\]/)).toBeTruthy()
  })

  it('Accept calls back without mutating; Discard leaves zero state', () => {
    const onAccept = vi.fn()
    const onDiscard = vi.fn()
    render(
      <DraftProposalPanel
        proposal={mappingProposal()}
        onAccept={onAccept}
        onDiscard={onDiscard}
      />,
    )
    fireEvent.click(screen.getByText('Accept and apply mapping'))
    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(onDiscard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Discard'))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })
})
