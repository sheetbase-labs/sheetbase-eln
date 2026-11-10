import type { DataClient } from './data-client'

/**
 * The calls a test supplies to `dataClientTestDouble`, with the transport's own
 * argument list. A read hands back the fixture rows the test wrote; each caller
 * parses its own copy, so the double never needs the caller's row type, and a
 * write answers with the fixture row, if any, the test decided it would return.
 */
type StubbedCalls = {
  list?: (...args: Parameters<DataClient['list']>) => Promise<readonly object[]>
  rpc?: (...args: Parameters<DataClient['rpc']>) => Promise<object | null>
  insert?: (...args: Parameters<DataClient['insert']>) => Promise<object | null>
  patch?: (
    ...args: Parameters<DataClient['patch']>
  ) => Promise<readonly object[]>
}

/**
 * A `DataClient` for tests. Every call a test supplies answers as that test
 * decided, and receives the arguments the caller passed; every call it did not
 * supply throws, so a test that reaches for an unstubbed call fails instead of
 * silently reading nothing.
 */
export function dataClientTestDouble(calls: StubbedCalls = {}): DataClient {
  const unstubbed = (method: keyof DataClient) => () => {
    throw new Error(`DataClient.${method} is not stubbed by this test`)
  }

  return {
    list: async <T>(resource: string, query?: string): Promise<T[]> =>
      // SAFETY: A test double answers with exactly the fixture rows its test wrote; the caller's row type is that test's own claim about them, and this transport never inspects a row.
      ((await calls.list?.(resource, query)) ?? []) as T[],
    count: unstubbed('count'),
    rpc: async <T>(
      name: string,
      args: Parameters<DataClient['rpc']>[1],
      options?: { changeReason?: string },
    ): Promise<T> => {
      const forwarded: Parameters<DataClient['rpc']> =
        options === undefined ? [name, args] : [name, args, options]

      // SAFETY: The test's own stub decides what this call answers; the caller's result type is the test's claim about the value it handed back.
      return ((await calls.rpc?.(...forwarded)) ?? {}) as T
    },
    insert: async <T>(
      resource: string,
      row: Parameters<DataClient['insert']>[1],
    ): Promise<T> =>
      // SAFETY: The test's own stub decides what this call answers; the caller's result type is the test's claim about the value it handed back.
      ((await calls.insert?.(resource, row)) ?? {}) as T,
    patch: async <T>(
      resource: string,
      query: string,
      row: Parameters<DataClient['patch']>[2],
    ): Promise<T[]> =>
      // SAFETY: A test double answers with exactly the fixture rows its test wrote; the caller's row type is that test's own claim about them.
      ((await calls.patch?.(resource, query, row)) ?? []) as T[],
    remove: unstubbed('remove'),
  }
}
