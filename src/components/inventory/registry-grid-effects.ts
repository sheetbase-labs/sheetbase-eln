import type { RefObject } from 'react'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
} from 'react'
import type {
  OnChangeFn,
  RowData,
  RowSelectionState,
  SortingState,
  ColumnVisibilityState,
} from '@tanstack/react-table'
import { functionalUpdate } from '@tanstack/react-table'
import { usePaneContext } from '#/components/workspace/workspace-navigation'
import { isBand } from './registry-grid-data'
import type { RegistryRow } from './registry-grid-data'
import type { RegistryGridProps } from './registry-grid'

/** Table options outlive renders. Only committed screen callbacks may escape through them. */
export function useRegistryEvents<T extends RowData>(
  props: Pick<
    RegistryGridProps<T>,
    'getRowId' | 'onRowClick' | 'onRowSelectionChange' | 'view'
  > & { onSortingChange?: OnChangeFn<SortingState> },
) {
  const committed = useRef(props)
  useLayoutEffect(() => {
    committed.current = props
  })

  const onRowClick = useCallback((row: RegistryRow<T>) => {
    if (isBand(row)) return
    const current = committed.current
    current.onRowSelectionChange?.({ [current.getRowId(row)]: true })
    current.onRowClick?.(row)
  }, [])

  const onRowSelectionChange = useCallback<OnChangeFn<RowSelectionState>>(
    (next) => committed.current.onRowSelectionChange?.(next),
    [],
  )

  const onSortingChange = useCallback<OnChangeFn<SortingState>>(
    (next) => committed.current.onSortingChange?.(next),
    [],
  )

  const onColumnVisibilityChange = useCallback<
    OnChangeFn<ColumnVisibilityState>
  >((next) => {
    committed.current.view?.setHidden((current) => {
      const was: ColumnVisibilityState = Object.fromEntries(
        current.map((id) => [id, false]),
      )

      const value = functionalUpdate(next, was)

      return Object.entries(value)
        .filter(([, shown]) => shown === false)
        .map(([id]) => id)
    })
  }, [])

  return {
    onRowClick,
    onRowSelectionChange,
    onSortingChange,
    onColumnVisibilityChange,
  }
}

/** A followed row moves the inspector only when the followed selection changes. */
export function useLinkedRegistrySelection<T extends RowData>({
  rows,
  getRowId,
  selectable,
  rowSelection,
  onRowSelectionChange,
}: Pick<RegistryGridProps<T>, 'rows' | 'getRowId' | 'onRowSelectionChange'> & {
  selectable: boolean
  rowSelection: RowSelectionState
}) {
  const { reportSelection, followedSelection } = usePaneContext()
  const selectedKey = Object.keys(rowSelection).at(0)
  useEffect(() => {
    // react-doctor-disable-next-line no-pass-data-to-parent -- Linked panes publish committed externally controlled selection, not only local clicks.
    if (selectable) reportSelection(selectedKey)
  }, [reportSelection, selectable, selectedKey])

  const follow = useEffectEvent(() => {
    if (
      !selectable ||
      !followedSelection ||
      followedSelection === selectedKey ||
      !rows.some((row) => !isBand(row) && getRowId(row) === followedSelection)
    )
      return
    onRowSelectionChange?.({ [followedSelection]: true })
  })

  useEffect(() => {
    // react-doctor-disable-next-line no-pass-data-to-parent -- The effect event synchronizes linked selection only when followedSelection commits, never on callback-only renders.
    follow()
  }, [followedSelection])
}

/** Roving row focus. Space is intentionally left to the workspace peek shortcut. */
export function useRegistryRowKeys<T extends RowData>(
  selectable: boolean,
  rows: RegistryRow<T>[],
) {
  const gridRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = gridRef.current

    if (!root || !selectable) return

    const rowOf = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest<HTMLTableRowElement>('tbody tr[data-index]')
        : null

    const sync = () => {
      const elements = [
        ...root.querySelectorAll<HTMLTableRowElement>('tbody tr[data-index]'),
      ]

      const selected = elements.find((tr) => tr.dataset.state === 'selected')

      for (const tr of elements)
        tr.tabIndex = tr === (selected ?? elements[0]) ? 0 : -1
    }

    const observer = new MutationObserver(sync)
    observer.observe(root, { childList: true, subtree: true })

    const onKeyDown = (event: KeyboardEvent) => {
      const tr = rowOf(event.target)

      if (!tr) return

      if (event.key === 'Enter') {
        event.preventDefault()
        tr.click()

        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const next =
          event.key === 'ArrowDown'
            ? tr.nextElementSibling
            : tr.previousElementSibling

        if (next instanceof HTMLTableRowElement && next.dataset.index) {
          event.preventDefault()
          next.focus()
        }
      }
    }

    root.addEventListener('keydown', onKeyDown)
    sync()

    return () => {
      observer.disconnect()
      root.removeEventListener('keydown', onKeyDown)
    }
  }, [selectable, rows])

  return gridRef
}

/**
 * Ticks a row without a tick box: Space on the focused row, or a Ctrl, Cmd or Shift click.
 * The boxes themselves appear once a row is ticked (see `RegistryGrid`).
 */
export function useRegistryTickKeys<T extends RowData>(
  gridRef: RefObject<HTMLDivElement | null>,
  toggleBulk: ((id: string) => void) | undefined,
  rows: RegistryRow<T>[],
  getRowId: (row: T) => string,
) {
  useEffect(() => {
    const root = gridRef.current

    if (!root || !toggleBulk) return

    const idOf = (target: EventTarget | null): string | null => {
      const tr =
        target instanceof Element
          ? target.closest<HTMLTableRowElement>('tbody tr[data-index]')
          : null

      const row = tr ? rows.at(Number(tr.dataset.index)) : undefined

      return row && !isBand(row) ? getRowId(row) : null
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' || !(event.target instanceof HTMLTableRowElement))
        return

      const id = idOf(event.target)

      if (id === null) return
      event.preventDefault()
      toggleBulk(id)
    }

    const onClick = (event: MouseEvent) => {
      if (!(event.metaKey || event.ctrlKey || event.shiftKey)) return

      const id = idOf(event.target)

      if (id === null) return
      event.preventDefault()
      event.stopPropagation()
      toggleBulk(id)
    }

    root.addEventListener('keydown', onKeyDown)
    root.addEventListener('click', onClick, true)

    return () => {
      root.removeEventListener('keydown', onKeyDown)
      root.removeEventListener('click', onClick, true)
    }
  }, [gridRef, toggleBulk, rows, getRowId])
}
