import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SignatureWire } from '#/lib/signatures'

import { SignaturesTable, signatureBindingNote } from './signatures-table'

// The verification line reads the server on its own; these tests are about the table.
vi.mock('#/components/review/audit-check-line', () => ({
  AuditCheckLine: () => null,
}))

afterEach(cleanup)

function signature(
  overrides: Partial<SignatureWire> & { id: string },
): SignatureWire {
  return {
    workspace_id: 'workspace',
    submission_id: 'submission',
    revision_id: 'revision-1',
    record_id: 'record',
    signature_meaning: 'reviewed',
    assurance_level: 'standard',
    revision_integrity_digest: 'a'.repeat(64),
    signer_user_id: 'user-2',
    signer_session_id: 'session-2',
    signer_role: 'reviewer',
    auth_method: 'password',
    confirmation_phrase: 'Mei L.',
    signed_at: '2026-09-19T10:05:00Z',
    created_at: '2026-09-19T10:05:00Z',
    signer_name: 'Mei L.',
    ...overrides,
  }
}

function bodyRows() {
  const table = screen.getByRole('table', { name: 'Signatures' })
  return within(table).getAllByRole('row').slice(1)
}

describe('SignaturesTable', () => {
  it('renders the record signatures oldest-first with their meaning labels, times, IDs and the binding note', () => {
    render(
      <SignaturesTable
        revisionVersions={{ 'revision-1': 1 }}
        signatures={[
          signature({
            id: 'SIG-8850',
            signature_meaning: 'reviewed',
            signer_name: 'Mei L.',
            signed_at: '2026-09-19T10:05:00Z',
          }),
          signature({
            id: 'SIG-8841',
            revision_id: 'revision-1',
            signature_meaning: 'authored',
            signer_name: 'Gareth P.',
            signed_at: '2026-09-18T16:22:00Z',
          }),
        ]}
      />,
    )

    const rows = bodyRows()
    expect(rows.length).toBe(2)
    expect(rows[0].textContent).toContain('Gareth P.')
    expect(rows[0].textContent).toContain('Authored')
    expect(rows[0].textContent).toContain('SIG-8841')
    expect(rows[1].textContent).toContain('Mei L.')
    expect(rows[1].textContent).toContain('Reviewed')
    expect(rows[1].textContent).toContain('SIG-8850')

    const times = document.querySelectorAll('time')
    expect(times[0].getAttribute('dateTime')).toBe('2026-09-18T16:22:00Z')
    expect(times[1].getAttribute('dateTime')).toBe('2026-09-19T10:05:00Z')

    expect(
      screen.getByText(
        'Each signature was made with a password re-entry and is bound to version 1 of this record.',
      ),
    ).toBeTruthy()
  })

  it('names every version a signature attests and never guesses an unknown version', () => {
    expect(signatureBindingNote([1])).toBe(
      'Each signature was made with a password re-entry and is bound to version 1 of this record.',
    )
    expect(signatureBindingNote([2, 1])).toBe(
      'Each signature was made with a password re-entry and is bound to versions 1 and 2 of this record.',
    )
    expect(signatureBindingNote([])).toBe(
      'Each signature was made with a password re-entry and is bound to the frozen revision it attests.',
    )
  })

  it('states an empty record honestly instead of rendering a blank table', () => {
    render(<SignaturesTable signatures={[]} />)

    expect(screen.getByText('No signatures yet')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText('Couldn’t load the signatures')).toBeNull()
  })

  it('reports a failed load as a failure, not as an empty or successful table', () => {
    render(<SignaturesTable signatures={[]} isError />)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Couldn’t load the signatures')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText('No signatures yet')).toBeNull()
  })

  it('does not present a pending load as a result', () => {
    render(<SignaturesTable signatures={[]} isLoading />)

    expect(screen.getByText('Loading signatures…')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText('No signatures yet')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
