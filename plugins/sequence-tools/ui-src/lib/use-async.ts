import { useEffect, useState } from 'react'

export interface Async<T> {
  data: T | undefined
  isPending: boolean
  isSuccess: boolean
  error: Error | null
}

/** Runs `load` once (and again when `key` changes) and reports where it is. */
export function useAsync<T>(load: () => Promise<T>, key: string): Async<T> {
  const [state, setState] = useState<Async<T>>({
    data: undefined,
    isPending: true,
    isSuccess: false,
    error: null,
  })

  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, isPending: true, error: null }))
    load().then(
      (data) => {
        if (live)
          setState({ data, isPending: false, isSuccess: true, error: null })
      },
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Promise rejections can be any value and are converted to Error below.
      (error: unknown) => {
        if (live)
          setState({
            data: undefined,
            isPending: false,
            isSuccess: false,
            error: error instanceof Error ? error : new Error(String(error)),
          })
      },
    )

    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}
