/**
 * EXP-05.4 — the conflict surface (`NbConflict`).
 *
 * Both sides render with their authors; a decision goes through
 * `resolve_cell_conflict` with the chosen value and a reason; a decision
 * without a reason is blocked; and a settled conflict shows its decision
 * instead of the controls.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDataClient } from '#/lib/data-client'
import { CellConflictPanel, parseEnteredValue } from './cell-conflict-panel'
import type { CellConflictRow } from './cell-conflict-panel'

vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({
    names: {},
    userLabel: (id: string) => `name:${id}`,
  }),
}))

afterEach(cleanup)

const ME = 'user-me'
const PRIYA = 'user-priya'
const REMOTE_VALUE = 7.5e11
const LOCAL_VALUE = 7.4e11

function openConflict(
  overrides: Partial<CellConflictRow> = {},
): CellConflictRow {
  return {
    id: 'conflict-1',
    sheet_instance_id: 'inst-1',
    row_key: 'row-6',
    field_id: 'field-1',
    local_value: LOCAL_VALUE,
    local_author_user_id: ME,
    local_at: '2026-10-10T10:14:00Z',
    remote_value: REMOTE_VALUE,
    remote_author_user_id: PRIYA,
    remote_at: '2026-10-10T10:09:00Z',
    state: 'open',
    resolved_value: null,
    resolved_by_user_id: null,
    resolved_at: null,
    reason: null,
    ...overrides,
  }
}

function resolvedConflict(
  overrides: Partial<CellConflictRow> = {},
): CellConflictRow {
  return openConflict({
    state: 'resolved',
    resolved_value: REMOTE_VALUE,
    resolved_by_user_id: ME,
    resolved_at: '2026-10-10T11:00:00Z',
    reason: 'Blank-corrected value from plate 2 re-read',
    ...overrides,
  })
}

describe('CellConflictPanel', () => {
  it('shows both values with who made each edit, and the value they replaced', () => {
    render(
      <CellConflictPanel
        conflict={openConflict()}
        currentUserId={ME}
        cellLabel="row 6, Capsid titre"
        previousValue={7.3e11}
      />,
    )

    expect(screen.getByText(/row 6, Capsid titre/)).toBeTruthy()
    expect(screen.getByText('750,000,000,000', { exact: false })).toBeTruthy()
    expect(screen.getByText('740,000,000,000', { exact: false })).toBeTruthy()
    expect(screen.getByText(/name:user-priya/)).toBeTruthy()
    expect(screen.getByText(/You · /)).toBeTruthy()
    expect(screen.getByText(/Both of you changed this cell from/)).toBeTruthy()
    expect(screen.queryByText('Resolved')).toBeNull()
  })

  it('resolves with a chosen side and a reason through resolve_cell_conflict', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(resolvedConflict())))
    const client = createDataClient(fetcher)
    render(
      <CellConflictPanel
        conflict={openConflict()}
        currentUserId={ME}
        client={client}
      />,
    )

    // The second option is the signed-in user's own offline edit.
    fireEvent.click(screen.getAllByRole('radio')[1])
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Use my re-read from plate 2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/db/rpc/resolve_cell_conflict')
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      p_conflict_id: 'conflict-1',
      p_value: LOCAL_VALUE,
      p_reason: 'Use my re-read from plate 2',
    })
  })

  it('resolves with a value the user enters', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(resolvedConflict())))
    const client = createDataClient(fetcher)
    render(
      <CellConflictPanel
        conflict={openConflict()}
        currentUserId={ME}
        client={client}
      />,
    )

    fireEvent.click(screen.getAllByRole('radio')[2])
    fireEvent.change(screen.getByLabelText('Your value'), {
      target: { value: '7.6' },
    })
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Re-read plate 3' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      p_conflict_id: 'conflict-1',
      p_value: 7.6,
      p_reason: 'Re-read plate 3',
    })
  })

  it('blocks resolving without a reason', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const client = createDataClient(fetcher)
    render(
      <CellConflictPanel
        conflict={openConflict()}
        currentUserId={ME}
        client={client}
      />,
    )

    const resolve = screen.getByRole('button', { name: 'Resolve' })
    expect((resolve as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(resolve)
    await Promise.resolve()
    expect(fetcher).not.toHaveBeenCalled()
    expect(screen.queryByText('Resolved')).toBeNull()
  })

  it('blocks resolving with an empty entered value even when a reason is given', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const client = createDataClient(fetcher)
    render(
      <CellConflictPanel
        conflict={openConflict()}
        currentUserId={ME}
        client={client}
      />,
    )

    fireEvent.click(screen.getAllByRole('radio')[2])
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'A reason' },
    })
    const resolve = screen.getByRole('button', { name: 'Resolve' })
    expect((resolve as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(resolve)
    await Promise.resolve()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('renders a resolved conflict as its decision, not the controls', () => {
    render(
      <CellConflictPanel conflict={resolvedConflict()} currentUserId={ME} />,
    )

    expect(screen.getByText('Resolved')).toBeTruthy()
    expect(screen.getByText('750,000,000,000', { exact: false })).toBeTruthy()
    expect(
      screen.getByText(/Blank-corrected value from plate 2 re-read/),
    ).toBeTruthy()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull()
    expect(screen.queryByLabelText('Reason')).toBeNull()
  })

  it('stays open and surfaces the error when the RPC refuses the decision', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: '22023',
          message: 'This conflict is already resolved',
        }),
        { status: 400 },
      ),
    )
    const client = createDataClient(fetcher)
    render(
      <CellConflictPanel
        conflict={openConflict()}
        currentUserId={ME}
        client={client}
      />,
    )

    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'A reason' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))

    await waitFor(() =>
      expect(screen.getByText(/already resolved/)).toBeTruthy(),
    )
    expect(screen.queryByText('Resolved')).toBeNull()
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeTruthy()
  })
})

describe('parseEnteredValue', () => {
  it('keeps numbers as numbers, booleans as booleans and text as trimmed text', () => {
    expect(parseEnteredValue(' 7.6 ')).toBe(7.6)
    expect(parseEnteredValue('7.6e11')).toBe(7.6e11)
    expect(parseEnteredValue('true')).toBe(true)
    expect(parseEnteredValue('false')).toBe(false)
    expect(parseEnteredValue('  negative control ')).toBe('negative control')
    expect(parseEnteredValue('   ')).toBe('')
  })
})
