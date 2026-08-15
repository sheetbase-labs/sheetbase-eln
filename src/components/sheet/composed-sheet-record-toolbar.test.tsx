import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveSheetRecordActions } from '#/lib/sheet-record-actions'
import { ComposedSheetRecordToolbar } from './composed-sheet-record-toolbar'

afterEach(cleanup)

describe('composed Sheet Record toolbar', () => {
  it('disables create when the Definition is link-only and focuses the next error', async () => {
    const onCreate = vi.fn()
    const onNextError = vi.fn()
    const actions = resolveSheetRecordActions({
      actions: [
        {
          id: '10000000-0000-4000-8000-000000000001',
          key: 'link',
          label: 'Link Sample',
          kind: 'link-record',
        },
      ],
    })
    render(
      <ComposedSheetRecordToolbar
        actions={actions}
        errors={[
          {
            rowKey: 'row-a',
            code: 'required_value',
            kind: 'validation',
            message: 'Required.',
          },
        ]}
        onLink={vi.fn()}
        onCreate={onCreate}
        onValidate={vi.fn()}
        onCommit={vi.fn()}
        onNextError={onNextError}
      />,
    )
    expect(
      screen
        .getByRole('button', { name: 'Create Record' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen
        .getByRole('button', { name: 'Link Sample' })
        .hasAttribute('disabled'),
    ).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: /Next error/ }))
    expect(onNextError).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Create Record' }))
    expect(onCreate).not.toHaveBeenCalled()
  })
})
