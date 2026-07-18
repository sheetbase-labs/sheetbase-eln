import { QueryClient } from '@tanstack/react-query'

export function createRouterContext() {
  const queryClient = new QueryClient()

  return {
    queryClient,
  }
}
