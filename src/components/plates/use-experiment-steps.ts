/**
 * The protocol steps of an experiment, for choosing which one a plate belongs
 * to. Empty while loading or when the notebook has no steps.
 */
import { useQuery } from '@tanstack/react-query'

import { notebookDataClient } from '#/lib/notebook-data'
import { recordSteps } from '#/lib/plate-step'

export const experimentStepKeys = {
  forRecord: (recordId: string) => ['plate-steps', recordId] as const,
}

export function useExperimentSteps(recordId: string) {
  return useQuery({
    queryKey: experimentStepKeys.forRecord(recordId),
    enabled: recordId !== '',
    staleTime: 15_000,
    queryFn: () => recordSteps(notebookDataClient, recordId),
  })
}
