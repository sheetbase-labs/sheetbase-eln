/** OPS-007 — tiny async-value hook for the preview checksum parity check. */
import { useEffect, useState } from 'react'

export function useAsync<T>(
  factory: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
): T | null {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    let active = true
    factory()
      .then((result) => {
        if (active) setValue(result)
      })
      .catch(() => {
        if (active) setValue(null)
      })
    return () => {
      active = false
    }
  }, deps)
  return value
}
