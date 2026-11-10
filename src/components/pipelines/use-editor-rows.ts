import { useState } from 'react'

interface EditorRow<T> {
  id: number
  value: T
}

interface EditorRows<T> {
  items: T[]
  rows: EditorRow<T>[]
  nextId: number
  pending?: EditorRows<T>
}

function identifyRows<T>(
  items: T[],
  previous: EditorRows<T>,
  sourceOrder: T[],
): EditorRows<T> {
  const available = new Map<T, number[]>()

  for (const row of previous.rows) {
    const ids = available.get(row.value) ?? []
    ids.push(row.id)
    available.set(row.value, ids)
  }

  let nextId = previous.nextId
  const used = new Set<number>()

  const rows = items.map((value, position) => {
    const source = sourceOrder[position]
    const ids = available.get(source)
    let retained = ids?.shift()

    while (retained !== undefined && used.has(retained)) retained = ids?.shift()

    const id = retained ?? nextId++
    used.add(id)

    return { id, value }
  })

  return { items, rows, nextId }
}

/**
 * UI-only identities, allocated once per inserted row, never from its name.
 * Edits keep the source row's identity even when authoring helpers replace it.
 * Removal/reorder callers supply the surviving source objects in their new order.
 * Unsolicited prop replacements retain only rows whose object identity is known.
 */
export function useEditorRows<T>(items: T[], onChange: (items: T[]) => void) {
  const [previous, setPrevious] = useState<EditorRows<T>>(() =>
    identifyRows(items, { items: [], rows: [], nextId: 0 }, []),
  )

  const current =
    previous.items === items
      ? previous
      : identifyRows(
          items,
          {
            ...previous,
            rows: [...previous.rows, ...(previous.pending?.rows ?? [])],
            nextId: previous.pending?.nextId ?? previous.nextId,
          },
          items,
        )

  if (previous.items !== items) setPrevious(current)

  function change(next: T[], sourceOrder = items) {
    const pending = identifyRows(
      next,
      {
        ...current,
        nextId: current.pending?.nextId ?? current.nextId,
      },
      sourceOrder,
    )

    // Keep rendering the controlled props if their owner defers or rejects an edit.
    setPrevious({ ...current, pending })
    onChange(next)
  }

  return { rows: current.rows, change }
}
