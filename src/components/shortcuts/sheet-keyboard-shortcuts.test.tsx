import { useRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SheetbaseGridHandle } from '#/components/sheet/sheetbase-grid'
import { ShortcutProvider } from './shortcut-provider'
import { SheetKeyboardShortcuts } from './sheet-keyboard-shortcuts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function gridHandle(column = 1) {
  return {
    editActiveInput: vi.fn(),
    commitEdit: vi.fn(),
    cancelEdit: vi.fn(),
    focus: vi.fn(),
    selectCell: vi.fn(),
    selectCellAddress: vi.fn(() => true),
    scrollCellIntoView: vi.fn(),
    snapshot: () => ({
      data: new Map([['B3', 'stored value']]),
      selection: { anchor: { row: 2, column }, focus: { row: 2, column } },
    }),
  } satisfies SheetbaseGridHandle
}

function Scene({
  handle,
  name = 'Grid',
  readOnly = false,
}: {
  handle: SheetbaseGridHandle
  name?: string
  readOnly?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={containerRef}>
      <SheetKeyboardShortcuts
        handle={handle}
        containerRef={containerRef}
        readOnly={readOnly}
        activeInput="display input"
        rowCount={6}
        columnCount={4}
      />
      <div role="grid" aria-label={name} tabIndex={0} />
      <input aria-label={`${name} editor`} />
    </div>
  )
}

describe('registered sheet keyboard actions', () => {
  it('edits the focused grid with the displayed input and moves to the next display column', () => {
    const first = gridHandle()
    const second = gridHandle(2)
    render(
      <ShortcutProvider definitions={[]}>
        <Scene handle={first} name="First" />
        <Scene handle={second} name="Second" />
      </ShortcutProvider>,
    )
    const grid = screen.getByRole('grid', { name: 'First' })
    fireEvent.keyDown(grid, { key: 'Enter' })
    fireEvent.keyDown(grid, { key: 'Tab' })
    expect(first.editActiveInput).toHaveBeenCalledWith('display input')
    expect(first.selectCell).toHaveBeenCalledWith(2, 2)
    expect(second.editActiveInput).not.toHaveBeenCalled()
    expect(second.selectCell).not.toHaveBeenCalled()
  })

  it.each(['MacIntel', 'Win32'])(
    'commits with the platform modifier, cancels, and suppresses insert while editing on %s',
    (platform) => {
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
      const handle = gridHandle()
      const insert = vi.fn()
      render(
        <ShortcutProvider
          definitions={[
            {
              id: 'notebook-insert-block',
              scope: 'notebook',
              keys: ['/'],
              description: 'Insert',
              handler: insert,
            },
          ]}
        >
          <Scene handle={handle} />
        </ShortcutProvider>,
      )
      const field = screen.getByRole('textbox')
      fireEvent.keyDown(field, { key: '/' })
      fireEvent.keyDown(field, {
        key: 'Enter',
        metaKey: platform === 'MacIntel',
        ctrlKey: platform === 'Win32',
      })
      fireEvent.keyDown(field, { key: 'Escape' })
      expect(insert).not.toHaveBeenCalled()
      expect(handle.commitEdit).toHaveBeenCalledOnce()
      expect(handle.cancelEdit).toHaveBeenCalledOnce()
      expect(handle.focus).toHaveBeenCalledTimes(2)
    },
  )

  it('leaves boundary Tab and read-only editing to the control without consuming them', () => {
    const handle = gridHandle(3)
    render(
      <ShortcutProvider definitions={[]}>
        <Scene handle={handle} readOnly />
      </ShortcutProvider>,
    )
    expect(fireEvent.keyDown(screen.getByRole('grid'), { key: 'Tab' })).toBe(
      true,
    )
    expect(fireEvent.keyDown(screen.getByRole('grid'), { key: 'Enter' })).toBe(
      true,
    )
    expect(
      fireEvent.keyDown(screen.getByRole('textbox'), {
        key: 'Enter',
        ctrlKey: true,
      }),
    ).toBe(true)
    expect(handle.editActiveInput).not.toHaveBeenCalled()
    expect(handle.selectCell).not.toHaveBeenCalled()
    expect(handle.commitEdit).not.toHaveBeenCalled()
  })
})
