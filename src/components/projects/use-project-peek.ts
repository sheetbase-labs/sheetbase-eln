import { useState } from 'react'

import type { ProjectRow } from './types'

/**
 * Which project the list's side panel shows. It follows the clicked row;
 * before any click it shows the first row, and `setPeek(false)` hides it until
 * another row is clicked.
 */
export function useProjectPeek(rows: readonly ProjectRow[]) {
  const [peek, setPeek] = useState<string | null | false>(null)

  const peeked =
    peek === false
      ? null
      : (rows.find((p) => p.id === peek) ?? rows.at(0) ?? null)

  return { peeked, setPeek }
}
