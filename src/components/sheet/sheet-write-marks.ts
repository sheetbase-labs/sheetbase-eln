/**
 * Save state per change: which typed cells are still saving and which failed.
 * The table keeps its one calm save line; Show changes adds a small mark on
 * each changed cell and a Save column in the change list, and a failed change
 * can be retried from either.
 */
import { useCallback, useMemo, useRef, useState } from 'react'

import { cellAddressKey } from '#/lib/sheet-cell-history'

export type CellWriteState = 'saving' | 'failed'

export interface TrackedCellWrite {
  key: string
  rowKey: string
  columnId: string
  before: string
  after: string
  at: Date
  state: CellWriteState
  retry: () => void
}

interface TrackedCell {
  rowKey: string
  columnId: string
  before: string
  after: string
}

export function useCellWriteMarks() {
  const [writes, setWrites] = useState<ReadonlyMap<string, TrackedCellWrite>>(
    () => new Map(),
  )

  // Each write gets a token, so an older write finishing late never clears
  // the mark of a newer write to the same cell.
  const tokens = useRef(new Map<string, number>())
  const nextToken = useRef(0)

  const track = useCallback(
    <T>(cells: readonly TrackedCell[], run: () => Promise<T>): Promise<T> => {
      const token = nextToken.current
      nextToken.current += 1

      const entries = cells.map((cell) => ({ cell, key: cellAddressKey(cell) }))

      for (const { key } of entries) tokens.current.set(key, token)

      /** The cells this write still owns: no newer write has replaced it. */
      const owned = () =>
        entries.filter(({ key }) => tokens.current.get(key) === token)

      const place = (state: CellWriteState, retry: () => void) => {
        const mine = owned()
        const at = new Date()

        setWrites((current) => {
          const next = new Map(current)

          for (const { cell, key } of mine)
            next.set(key, {
              key,
              ...cell,
              at: current.get(key)?.at ?? at,
              state,
              retry,
            })

          return next
        })
      }

      const attempt = async (): Promise<T> => {
        place('saving', () => {})

        try {
          const result = await run()
          const mine = owned()

          for (const { key } of mine) tokens.current.delete(key)

          setWrites((current) => {
            const next = new Map(current)

            for (const { key } of mine) next.delete(key)

            return next
          })

          return result
        } catch (cause) {
          place('failed', () => {
            void attempt().catch(() => {})
          })

          throw cause
        }
      }

      return attempt()
    },
    [],
  )

  /** The unsaved or failed write on a cell, if it has one. */
  const writeFor = useCallback(
    (rowKey: string | undefined, columnId: string) =>
      rowKey === undefined
        ? undefined
        : writes.get(cellAddressKey({ rowKey, columnId })),
    [writes],
  )

  const pending = useMemo(
    () => [...writes.values()].sort((a, b) => +b.at - +a.at),
    [writes],
  )

  return { track, writeFor, pending }
}
