import { createContext, useContext } from 'react'

export interface SampleActions {
  openWithdraw: () => void
  openReserve: () => void
  /** Shared lifecycle permission for the header and Usage tab. */
  canWithdraw: boolean
}

export const SampleActionsContext = createContext<SampleActions | null>(null)

/** Null outside the sample frame. */
export function useSampleActions(): SampleActions | null {
  return useContext(SampleActionsContext)
}
