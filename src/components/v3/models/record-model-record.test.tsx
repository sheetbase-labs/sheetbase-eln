/**
 * MOB-02.4 — the workspace model record page on a phone.
 *
 * The page is already one column of fields, so the phone treatment is the
 * action placement `canvas/RecordPhone.dc.html` draws: the header keeps the
 * desktop actions and, below the phone breakpoint, they reappear at the end of
 * the column as full-width 44px targets (`size="lg"` → `h-11`). jsdom cannot
 * evaluate the media queries, so the split is proved by the responsive classes,
 * as `app-shell.test.tsx` does for the phone shell.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RecordModelRecord } from './record-model-record'

const mocks = vi.hoisted(() => {
  const record = {
    id: 'rec-1',
    identifier: 'CB-0012',
    title: 'HEK293 WCB lot 3',
    kind: 'cell_bank',
    status: 'draft',
    custom_fields: null,
    properties: null,
    tags: [],
    created_at: '2026-07-14T00:00:00.000Z',
    updated_at: '2026-09-25T00:00:00.000Z',
    archived_at: null,
  }
  return { record }
})

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
  } & Record<string, unknown>) => {
    let href = to
    for (const [key, value] of Object.entries(params ?? {}))
      href = href.replace(`$${key}`, encodeURIComponent(String(value)))
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

vi.mock('./models-data', () => ({
  useWorkspaceRecordModel: () => ({
    data: { name: 'Cell bank', current_version: 4 },
    isLoading: false,
  }),
  useRecordModelFields: () => ({ data: [], isLoading: false }),
  useRecordModelRecord: () => ({ data: mocks.record, isLoading: false }),
  useRecordModelUsedBy: () => ({ data: [], isLoading: false }),
  useRecordModelTimeline: () => ({ data: [], isLoading: false }),
  laterAddedModelFields: () => [],
  recordFieldValue: () => undefined,
}))

afterEach(cleanup)

/** The class tokens on the element that wraps the action, not a substring. */
function wrapperClasses(button: HTMLElement): string[] {
  return (button.parentElement?.className ?? '').split(/\s+/)
}

describe('RecordModelRecord — phone actions (MOB-02.4)', () => {
  it('moves the record actions to the end of the phone column', () => {
    render(<RecordModelRecord modelKey="cell_bank" recordId="rec-1" />)

    // The record's essentials read in the single column either way.
    expect(screen.getAllByText('HEK293 WCB lot 3').length).toBeGreaterThan(0)
    expect(screen.getAllByText('CB-0012').length).toBeGreaterThan(0)
    expect(screen.getByText(/Cell bank · model v4/)).toBeTruthy()

    for (const name of ['New Cell bank', 'All records']) {
      const buttons = screen.getAllByRole('button', { name })
      expect(buttons).toHaveLength(2)
      const [desktop, phone] = buttons
      expect(wrapperClasses(desktop)).toContain('max-md:hidden')
      expect(wrapperClasses(phone)).toContain('md:hidden')
      // 44px full-width touch target, as the phone canvas draws them.
      expect(phone.className).toContain('h-11')
    }
  })
})
