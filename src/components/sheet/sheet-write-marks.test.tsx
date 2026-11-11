import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SheetChangeList } from './sheet-changes-panel'
import type { SheetChangeRow } from './sheet-changes-panel'
import { useCellWriteMarks } from './sheet-write-marks'

const cell = { rowKey: 'row-9', columnId: 'load', before: '150', after: '146' }

afterEach(cleanup)

describe('useCellWriteMarks', () => {
  it('marks a cell saving, then clears it once the write lands', async () => {
    const { result } = renderHook(() => useCellWriteMarks())
    let finish: (value: string) => void = () => {}

    let done: Promise<string> = Promise.resolve('')

    act(() => {
      done = result.current.track(
        [cell],
        () => new Promise<string>((resolve) => (finish = resolve)),
      )
    })
    expect(result.current.writeFor('row-9', 'load')?.state).toBe('saving')

    await act(async () => {
      finish('ok')
      await done
    })
    expect(result.current.writeFor('row-9', 'load')).toBeUndefined()
  })

  it('keeps a failed write with a retry that writes it again', async () => {
    const { result } = renderHook(() => useCellWriteMarks())

    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('Server unavailable'))
      .mockResolvedValueOnce('ok')

    await act(async () => {
      await result.current.track([cell], run).catch(() => {})
    })

    const failed = result.current.writeFor('row-9', 'load')
    expect(failed?.state).toBe('failed')
    expect(result.current.pending).toHaveLength(1)

    await act(async () => {
      failed?.retry()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(run).toHaveBeenCalledTimes(2)
    expect(result.current.writeFor('row-9', 'load')).toBeUndefined()
  })
})

describe('SheetChangeList save column', () => {
  const row = (
    save: SheetChangeRow['save'],
    onRetry?: () => void,
  ): SheetChangeRow => ({
    id: `r-${save}`,
    cellKey: 'row-9|load',
    who: 'You',
    when: '09:41',
    cell: 'Row 9 · Load',
    before: '150',
    after: '146',
    beforeKnown: true,
    reason: null,
    save,
    onRetry,
  })

  it('says how each change saved and retries a failed one', () => {
    const onRetry = vi.fn()
    render(
      <SheetChangeList
        rows={[row('failed', onRetry), row('saving'), row(undefined)]}
        todayCount={1}
        selectedCellKey={null}
        onSelect={() => {}}
      />,
    )

    expect(screen.getByText('Save failed')).toBeTruthy()
    expect(screen.getByText('Saving…')).toBeTruthy()
    expect(screen.getByText('Saved')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
