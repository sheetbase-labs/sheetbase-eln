import { useLayoutEffect, useRef } from 'react'

/** Latest committed input for long-lived editor callbacks, never render data. */
export function useCommittedRef<T>(value: T) {
  const ref = useRef(value)

  useLayoutEffect(() => {
    ref.current = value
  })

  return ref
}
