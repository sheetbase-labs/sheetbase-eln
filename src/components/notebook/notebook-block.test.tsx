import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { NotebookBlock } from './notebook-block'

afterEach(() => cleanup())
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

describe('NotebookBlock', () => {
  it('keeps the block type semantic via data attribute', () => {
    const { container } = render(
      <NotebookBlock label="H2" title="Methods">
        body
      </NotebookBlock>,
    )
    expect(container.querySelector('[data-block-type="H2"]')).toBeTruthy()
    expect(screen.getByText('Methods')).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
  })

  it('exposes a data-state reflecting the block state', () => {
    const { container } = render(
      <NotebookBlock label="Paragraph" state="invalid">
        body
      </NotebookBlock>,
    )
    expect(container.querySelector('[data-state="invalid"]')).toBeTruthy()
  })

  it('renders a focusable drag handle when draggable', () => {
    render(
      <NotebookBlock label="Table" draggable>
        body
      </NotebookBlock>,
    )
    const handle = screen.getByRole('button', { name: 'Drag block' })
    expect(handle.getAttribute('draggable')).toBe('true')
  })

  it('does not render a drag handle when not draggable', () => {
    render(<NotebookBlock label="Table">body</NotebookBlock>)
    expect(screen.queryByRole('button', { name: 'Drag block' })).toBeNull()
  })

  it('shows a locked indicator and disables menu actions in locked state', async () => {
    const onEdit = vi.fn()
    const user = userEvent.setup()
    render(
      <NotebookBlock
        label="Paragraph"
        state="locked"
        menuItems={[{ id: 'edit', label: 'Edit', onSelect: onEdit }]}
      >
        body
      </NotebookBlock>,
    )
    expect(screen.getByLabelText('Block locked')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Block actions' }))
    const editItem = screen.getByRole('menuitem', { name: 'Edit' })
    await user.click(editItem)
    expect(onEdit).not.toHaveBeenCalled() // disabled by readOnly
  })

  it('shows an invalid indicator', () => {
    render(
      <NotebookBlock label="Table" state="invalid">
        body
      </NotebookBlock>,
    )
    expect(screen.getByLabelText('Block has errors')).toBeTruthy()
  })

  it('renders a loading skeleton and no body content', () => {
    render(
      <NotebookBlock label="Chart" state="loading">
        real content
      </NotebookBlock>,
    )
    expect(screen.queryByText('real content')).toBeNull()
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('opens the action menu and fires onSelect', async () => {
    const onDelete = vi.fn()
    const user = userEvent.setup()
    render(
      <NotebookBlock
        label="Paragraph"
        menuItems={[
          { id: 'delete', label: 'Delete block', onSelect: onDelete },
        ]}
      >
        body
      </NotebookBlock>,
    )
    await user.click(screen.getByRole('button', { name: 'Block actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete block' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('keeps read-only content non-interactive', () => {
    const { container } = render(
      <NotebookBlock label="Paragraph" state="read-only">
        <button type="button">inner</button>
      </NotebookBlock>,
    )
    const inner = screen.getByRole('button', { name: 'inner' })
    // pointer-events-none is applied to the read-only body wrapper.
    expect(inner.parentElement?.className).toContain('pointer-events-none')
    void container
  })
})
