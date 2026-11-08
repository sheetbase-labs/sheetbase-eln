import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginRecordList } from './plugin-record-panel'
import type { PluginFlag } from '#/lib/plugin-record-data'

const step: PluginFlag = {
  id: 'f1',
  extension_key: 'lab-rules',
  extension_name: 'Lab rules',
  flag_key: 'second-reviewer',
  kind: 'sign_off',
  title: 'A second reviewer has looked at this',
  message: 'Someone other than the sender.',
  roles: ['reviewer'],
  approvals_needed: 2,
  independent: true,
  raised_by_user_id: 'maker',
  raised_at: '2026-11-08T10:00:00Z',
  signed: 1,
  signedByMe: false,
}

afterEach(cleanup)

describe('PluginRecordList', () => {
  it('shows a sign-off step with a button that asks to sign it', () => {
    const onSignOff = vi.fn()
    render(
      <PluginRecordList
        state={{ flags: [step], summaries: [] }}
        myUserId="other"
        onSignOff={onSignOff}
      />,
    )
    expect(screen.getByText(step.title)).toBeTruthy()
    expect(screen.getByText(/1 of 2 signed/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign off' }))
    expect(onSignOff).toHaveBeenCalledWith(step)
  })

  it('offers no button to the person who made the change, or who already signed', () => {
    const { rerender } = render(
      <PluginRecordList
        state={{ flags: [step], summaries: [] }}
        myUserId="maker"
        onSignOff={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Sign off' })).toBeNull()
    rerender(
      <PluginRecordList
        state={{ flags: [{ ...step, signedByMe: true }], summaries: [] }}
        myUserId="other"
        onSignOff={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Sign off' })).toBeNull()
  })

  it('shows a hold and a summary', () => {
    render(
      <PluginRecordList
        state={{
          flags: [
            { ...step, kind: 'flag', title: 'Out of range', message: 'pH 9' },
          ],
          summaries: [
            {
              extension_key: 'lab-rules',
              extension_name: 'Lab rules',
              hook_id: 's',
              summary: 'EXP-1: Titration (draft)',
              updated_at: '',
            },
          ],
        }}
        myUserId="other"
      />,
    )
    expect(screen.getByText(/On hold · pH 9/)).toBeTruthy()
    expect(screen.getByText('EXP-1: Titration (draft)')).toBeTruthy()
  })
})
