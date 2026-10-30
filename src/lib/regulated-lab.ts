import { useQuery } from '@tanstack/react-query'

import {
  fetchWorkspaceGeneral,
  workspaceGeneralQueryKey,
} from './workspace-general'

/**
 * Whether this workspace runs by regulated-lab rules. A workspace with no
 * settings yet is not regulated, and nothing is held back while it loads.
 */
export function useRegulatedLab(workspaceId: string | undefined): {
  regulated: boolean
  loaded: boolean
} {
  const general = useQuery({
    queryKey: workspaceGeneralQueryKey,
    queryFn: () => fetchWorkspaceGeneral(),
    enabled: Boolean(workspaceId),
  })
  return {
    regulated: general.data?.regulatedLab ?? false,
    loaded: general.isSuccess,
  }
}
