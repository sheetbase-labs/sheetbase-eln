import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ProtocolVersion } from '#/lib/controlled-protocols'
import { ProtocolVersionTraining } from './protocol-version-training'

afterEach(cleanup)

const version: ProtocolVersion = {
  id: '00000000-0000-4000-8000-00000000b702',
  workspace_id: '00000000-0000-4000-8000-00000000b700',
  protocol_record_id: '00000000-0000-4000-8000-00000000b701',
  version: 3,
  status: 'effective',
  effective_at: '2026-09-02T00:00:00Z',
  review_due_at: '2027-09-02T00:00:00Z',
  change_summary: 'Hold parameters clarified.',
  created_by_user_id: 'author',
  created_at: '2026-08-28T00:00:00Z',
}
const members = [
  { user_id: 'sam', name: 'Sam' },
  { user_id: 'mei', name: 'Mei' },
]

describe('ProtocolVersionTraining', () => {
  it('does not treat acknowledgement of another revision as training on this one', () => {
    const onAcknowledge = vi.fn()
    render(
      <ProtocolVersionTraining
        version={version}
        members={members}
        currentUserId="sam"
        acknowledging={false}
        writer
        onAcknowledge={onAcknowledge}
        acknowledgements={[
          {
            protocol_version_id: '00000000-0000-4000-8000-00000000b799',
            user_id: 'sam',
            acknowledged_at: '2026-09-03T00:00:00Z',
          },
        ]}
      />,
    )
    expect(screen.getAllByText('Required')).toHaveLength(2)
    fireEvent.click(
      screen.getByRole('button', { name: 'Read and acknowledge' }),
    )
    expect(onAcknowledge).toHaveBeenCalledExactlyOnceWith()
    expect(
      screen.queryByRole('button', { name: /record training/i }),
    ).toBeNull()
  })

  it('prevents repeat acknowledgement and retains supplied per-user dates', () => {
    render(
      <ProtocolVersionTraining
        version={version}
        members={members}
        currentUserId="sam"
        acknowledging={false}
        writer
        onAcknowledge={vi.fn()}
        acknowledgements={[
          {
            protocol_version_id: version.id,
            user_id: 'sam',
            acknowledged_at: '2026-09-03T00:00:00Z',
          },
        ]}
      />,
    )
    expect(
      screen
        .getByRole('button', { name: 'Acknowledged' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.getByText('2026-09-03')).toBeTruthy()
    expect(screen.getAllByText('Required')).toHaveLength(1)
  })

  it('keeps a failed acknowledgement retryable without claiming success', () => {
    render(
      <ProtocolVersionTraining
        version={version}
        members={members}
        currentUserId="sam"
        acknowledging={false}
        writer
        onAcknowledge={vi.fn()}
        acknowledgements={[]}
        error="The server refused acknowledgement."
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe(
      'The server refused acknowledgement.',
    )
    expect(
      screen
        .getByRole('button', { name: 'Read and acknowledge' })
        .hasAttribute('disabled'),
    ).toBe(false)
    expect(screen.getAllByText('Required')).toHaveLength(2)
  })

  it('does not offer acknowledgement on a retired version', () => {
    const onAcknowledge = vi.fn()
    render(
      <ProtocolVersionTraining
        version={{ ...version, status: 'retired' }}
        members={members}
        currentUserId="sam"
        acknowledging={false}
        writer
        onAcknowledge={onAcknowledge}
        acknowledgements={[]}
      />,
    )
    const button = screen.getByRole('button', { name: 'Read and acknowledge' })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(onAcknowledge).not.toHaveBeenCalled()
    expect(
      screen.getByText('This version is not available for acknowledgement.'),
    ).toBeTruthy()
  })

  it('prevents repeated submission while acknowledgement is pending', () => {
    const onAcknowledge = vi.fn()
    render(
      <ProtocolVersionTraining
        version={version}
        members={members}
        currentUserId="sam"
        acknowledging
        writer
        onAcknowledge={onAcknowledge}
        acknowledgements={[]}
      />,
    )
    const button = screen.getByRole('button', { name: 'Acknowledging…' })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(onAcknowledge).not.toHaveBeenCalled()
  })

  it('refuses to offer acknowledgement to a viewer and says why', () => {
    const onAcknowledge = vi.fn()
    render(
      <ProtocolVersionTraining
        version={version}
        members={members}
        currentUserId="anna"
        acknowledging={false}
        writer={false}
        onAcknowledge={onAcknowledge}
        acknowledgements={[]}
      />,
    )
    // The viewer's own row still reads as owed, but the control is disabled —
    // the server's `is_workspace_writer` gate would refuse the write.
    expect(screen.getAllByText('Required')).toHaveLength(2)
    const button = screen.getByRole('button', { name: 'Read and acknowledge' })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(onAcknowledge).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        'Only a workspace writer can acknowledge a protocol version.',
      ),
    ).toBeTruthy()
  })
})
