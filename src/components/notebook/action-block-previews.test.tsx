import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  CorrectiveActionsPreview,
  SignatureRequestPreview,
} from './action-block-previews'
import { defaultPayloadFor } from '#/lib/notebook-mutations'

afterEach(cleanup)

describe('SignatureRequestPreview (R5-NOTE-02)', () => {
  it('renders the missing-reference state for the block the picker just added', () => {
    render(
      <SignatureRequestPreview
        payload={defaultPayloadFor('signature_request')}
      />,
    )
    const block = screen.getByTestId('signature-request-block')
    expect(block.getAttribute('data-state')).toBe('unassigned')
    expect(block.textContent).toContain('No signer chosen')
    expect(block.textContent).toContain('Choose who should sign')
  })

  it('renders the requested signer, meaning and live state', () => {
    render(
      <SignatureRequestPreview
        payload={{
          requestedUserId: 'u-1',
          requestedUserName: 'Ada Lovelace',
          meaning: 'reviewed-and-approved',
          note: 'Please review the runs.',
        }}
      />,
    )
    const block = screen.getByTestId('signature-request-block')
    expect(block.getAttribute('data-state')).toBe('awaiting')
    expect(block.textContent).toContain('Ada Lovelace')
    expect(block.textContent).toContain('Reviewed and approved')
    expect(block.textContent).toContain('Please review the runs.')
  })

  it('reports a signature recorded against a revision that is no longer current', () => {
    render(
      <SignatureRequestPreview
        payload={{
          requestedUserId: 'u-1',
          requestedUserName: 'Ada Lovelace',
          meaning: 'reviewed',
          note: '',
        }}
        context={{
          revisionId: 'rev-2',
          signatures: [
            {
              id: 'sig-1',
              workspace_id: 'ws-1',
              submission_id: 'sub-1',
              revision_id: 'rev-1',
              record_id: 'record-1',
              signature_meaning: 'reviewed',
              assurance_level: 'standard',
              revision_integrity_digest: 'a'.repeat(64),
              signer_user_id: 'u-1',
              signer_session_id: 's-1',
              signer_role: 'authenticated',
              auth_method: 'password',
              confirmation_phrase: 'Ada Lovelace',
              signed_at: '2026-10-11T10:00:00Z',
              created_at: '2026-10-11T10:00:00Z',
              signer_name: 'Ada Lovelace',
            },
          ],
        }}
      />,
    )
    expect(
      screen.getByTestId('signature-request-block').getAttribute('data-state'),
    ).toBe('changed')
  })

  it('preserves a payload this build does not understand instead of hiding it', () => {
    render(<SignatureRequestPreview payload={{ meaning: 3 }} />)
    expect(screen.queryByTestId('signature_request-invalid')).not.toBeNull()
  })
})

describe('CorrectiveActionsPreview (R5-NOTE-02)', () => {
  it('renders the empty state for the block the picker just added', () => {
    render(
      <CorrectiveActionsPreview
        payload={defaultPayloadFor('corrective_actions')}
      />,
    )
    expect(
      screen.getByTestId('corrective-actions-empty').textContent,
    ).toContain('No corrective actions yet')
  })

  it('renders actions and flags the missing owner reference', () => {
    render(
      <CorrectiveActionsPreview
        payload={{
          items: [
            {
              id: 'CAPA-1',
              action: 'Repeat the reading at 1:5 dilution',
              ownerUserId: 'u-1',
              ownerName: 'Gareth P.',
              due: '2026-10-03',
              status: 'in-progress',
            },
            {
              id: 'CAPA-2',
              action: 'Brief the team',
              ownerUserId: null,
              ownerName: null,
              due: null,
              status: 'open',
            },
          ],
        }}
      />,
    )
    const block = screen.getByTestId('corrective-actions-block')
    expect(block.textContent).toContain('Repeat the reading at 1:5 dilution')
    expect(block.textContent).toContain('Gareth P.')
    expect(screen.getAllByText('No owner').length).toBeGreaterThan(0)
    expect(block.textContent).toContain('1 without an owner')
  })

  it('renders the invalid-payload state honestly', () => {
    render(<CorrectiveActionsPreview payload={{ items: 'nope' }} />)
    expect(screen.queryByTestId('corrective_actions-invalid')).not.toBeNull()
  })
})
