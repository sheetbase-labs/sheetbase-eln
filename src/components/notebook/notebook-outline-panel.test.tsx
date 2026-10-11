import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { NotebookOutlinePanel } from './notebook-outline-panel'
import type { NotebookBlock } from '#/lib/notebook-data'

afterEach(cleanup)

let seq = 0
function block(type: string, payload: Record<string, unknown>): NotebookBlock {
  seq += 1
  return {
    id: `block-${seq}`,
    recordId: 'record-1',
    type,
    payload,
    payloadSchemaVersion: 1,
    order: seq,
    version: 1,
  }
}

describe('NotebookOutlinePanel — required sections and requested signatures', () => {
  it('checks the record type\u2019s sections against the blocks', () => {
    render(
      <NotebookOutlinePanel
        entries={[]}
        blocks={[block('rich_text', { title: 'Materials' })]}
        requiredSections={[
          { label: 'Materials', state: 'present' },
          { label: 'Method', state: 'missing' },
        ]}
      />,
    )
    const checklist = screen.getByTestId('required-section-checklist')
    expect(checklist.textContent).toContain('Materials')
    const missing = checklist.querySelector('[data-section="Method"]')
    expect(missing?.textContent).toContain('Method')
    expect(missing?.textContent).toContain('missing')
    expect(missing?.getAttribute('data-state')).toBe('missing')
  })

  it('omits the checklist when the record type requires no sections', () => {
    render(
      <NotebookOutlinePanel entries={[]} blocks={[]} requiredSections={[]} />,
    )
    expect(screen.queryByTestId('required-section-checklist')).toBeNull()
  })

  it('builds the requested-signature table from the same blocks', () => {
    render(
      <NotebookOutlinePanel
        entries={[]}
        blocks={[
          block('signature_request', {
            requestedUserId: null,
            requestedUserName: 'Ada Lovelace',
            meaning: 'reviewed-and-approved',
            note: '',
          }),
        ]}
      />,
    )
    const table = screen.getByTestId('requested-signatures')
    expect(table.textContent).toContain('Ada Lovelace')
    expect(table.textContent).toContain('Reviewed and approved')
    expect(table.textContent).toContain('Requested for the next submission')
  })

  it('says so when the document carries no signature requests', () => {
    render(<NotebookOutlinePanel entries={[]} blocks={[]} />)
    expect(
      screen.getByTestId('requested-signatures-empty').textContent,
    ).toContain('No signature requests')
  })
})
