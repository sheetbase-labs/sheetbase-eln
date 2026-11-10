import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '#/copy'
import { SheetPasteData } from './sheet-paste-data'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SheetPasteData', () => {
  it('keeps its empty defaults and applies the parsed pasted table', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<SheetPasteData open onOpenChange={vi.fn()} onApply={onApply} />)

    const textarea = screen.getByRole('textbox', {
      name: t('notebook.sheetPasteData.label'),
    })

    const apply = screen.getByRole('button', {
      name: t('notebook.sheetPasteData.addToSheet'),
    })

    expect(textarea.textContent).toBe('')
    expect(textarea.className).toContain('font-mono text-xs')
    expect(apply.hasAttribute('disabled')).toBe(true)
    fireEvent.change(textarea, {
      target: { value: 'Name\tAmount\nSample A\t1.5' },
    })
    expect(screen.getByRole('status').textContent).toContain('Name, Amount')
    await user.click(apply)
    expect(onApply).toHaveBeenCalledExactlyOnceWith({
      headers: ['Name', 'Amount'],
      rows: [['Sample A', '1.5']],
      clipped: { columns: 0, rows: 0 },
    })
  })

  it('loads a selected file into the same editable draft', async () => {
    const user = userEvent.setup()
    render(<SheetPasteData open onOpenChange={vi.fn()} onApply={vi.fn()} />)
    const content = 'Name,Amount\nSample A,2'

    // jsdom's File lacks Blob.text(); keep a real File with that browser method.
    const file = Object.assign(
      new File([content], 'data.csv', { type: 'text/csv' }),
      { text: async () => content },
    )

    await user.upload(
      screen.getByLabelText(t('notebook.sheetPasteData.ariaLabel')),
      file,
    )
    await waitFor(() => {
      const textarea = screen.getByRole('textbox')

      if (!(textarea instanceof HTMLTextAreaElement))
        throw new Error('Expected the pasted-data textarea')
      expect(textarea.value).toBe(content)
    })
    expect(screen.getByRole('status').textContent).toContain('Name, Amount')
  })

  it('handles an unreadable file without losing the pasted draft and clears the error on editing', async () => {
    const user = userEvent.setup()
    render(<SheetPasteData open onOpenChange={vi.fn()} onApply={vi.fn()} />)
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'Name\nSample A' } })

    const file = Object.assign(
      new File([], 'unreadable.csv', { type: 'text/csv' }),
      {
        text: async () => {
          throw new DOMException('Unreadable file', 'NotReadableError')
        },
      },
    )

    await user.upload(
      screen.getByLabelText(t('notebook.sheetPasteData.ariaLabel')),
      file,
    )
    expect((await screen.findByRole('alert')).textContent).toBe(
      t('common.errors.generic'),
    )

    if (!(textarea instanceof HTMLTextAreaElement))
      throw new Error('Expected the pasted-data textarea')
    expect(textarea.value).toBe('Name\nSample A')
    fireEvent.change(textarea, { target: { value: 'Name\nSample B' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      screen
        .getByRole('button', { name: t('notebook.sheetPasteData.addToSheet') })
        .hasAttribute('disabled'),
    ).toBe(false)
  })

  it('resets the draft when cancelled and disables import controls while busy', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onApply = vi.fn()

    const { rerender } = render(
      <SheetPasteData open onOpenChange={onOpenChange} onApply={onApply} />,
    )

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Name\nSample A' },
    })
    await user.click(
      screen.getByRole('button', { name: t('common.actions.cancel') }),
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
    rerender(
      <SheetPasteData
        open={false}
        onOpenChange={onOpenChange}
        onApply={onApply}
      />,
    )
    rerender(
      <SheetPasteData
        open
        busy
        onOpenChange={onOpenChange}
        onApply={onApply}
      />,
    )
    const textarea = screen.getByRole('textbox')

    if (!(textarea instanceof HTMLTextAreaElement))
      throw new Error('Expected the pasted-data textarea')
    expect(textarea.value).toBe('')
    expect(textarea.disabled).toBe(true)
    expect(
      screen
        .getByLabelText(t('notebook.sheetPasteData.ariaLabel'))
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen
        .getByRole('button', { name: t('notebook.sheetPasteData.adding') })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(onApply).not.toHaveBeenCalled()
  })
})
