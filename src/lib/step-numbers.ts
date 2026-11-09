import * as React from 'react'

/**
 * The number each protocol step shows when the experiment has parts: its place
 * within its own part, the same number the Now card and the Summary use. Keyed
 * by block id; with no entry a step shows the number it was written with.
 */
const StepNumbersContext = React.createContext<ReadonlyMap<string, number>>(
  new Map(),
)

export const StepNumbersProvider = StepNumbersContext.Provider

export function useStepNumber(
  blockId: string | undefined,
  written: number | null | undefined,
): number | null {
  const numbers = React.useContext(StepNumbersContext)
  const shown = blockId ? numbers.get(blockId) : undefined

  return shown ?? written ?? null
}
