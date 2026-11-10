import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DataClient } from '#/lib/data-client'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import type { ComposedSheetSnapshot } from '#/lib/sheet-composition-data'
import {
  readSheetInstanceCalculationResults,
  recalculateSheetInstance,
} from '#/lib/sheet-local-data'
import type { SheetInstanceCalculationResult } from '#/lib/sheet-local-data'

/** Calculation windows commit in order before their results are read. */
export function useCanonicalWorkspaceCalculations({
  instance,
  composedSnapshot,
  canWrite,
  client,
}: {
  instance: SheetInstance
  composedSnapshot: ComposedSheetSnapshot | null
  canWrite: boolean
  client: DataClient
}) {
  const rowKeys = useMemo(
    () =>
      composedSnapshot
        ? composedSnapshot.rows.map((row) => row.rowKey)
        : Object.keys(instance.state.localValues),
    [composedSnapshot, instance.state.localValues],
  )

  return useQuery({
    queryKey: [
      'sheet-calc-results',
      instance.id,
      instance.revision,
      rowKeys,
      canWrite,
    ],
    enabled: rowKeys.length > 0,
    queryFn: async () => {
      if (
        canWrite &&
        composedSnapshot &&
        (instance.state.instanceCalculations?.some(
          (calculation) => calculation.lifecycle === 'active',
        ) ||
          composedSnapshot.definitionConfiguration?.calculations.length)
      ) {
        const offsets = new Set(
          composedSnapshot.rows.map((row) => row.compositionOffset ?? 0),
        )

        // Each POST commits results, retry history and audit events under the
        // same instance lock. Stop at the first refusal; do not commit later
        // windows after an earlier window failed. Reads below remain parallel.
        for (const offset of offsets) {
          // react-doctor-disable-next-line react-doctor/async-await-in-loop
          await recalculateSheetInstance({
            instanceId: instance.id,
            expectedRevision: instance.revision,
            offset,
            limit: 200,
          })
        }
      }

      const batches = await Promise.all(
        Array.from({ length: Math.ceil(rowKeys.length / 200) }, (_, index) =>
          readSheetInstanceCalculationResults(
            instance.id,
            rowKeys.slice(index * 200, (index + 1) * 200),
            client,
          ),
        ),
      )

      const rows = batches.flatMap((batch) => batch.results)

      const mapped: Record<
        string,
        Record<string, SheetInstanceCalculationResult['calculatedValue']>
      > = {}

      for (const row of rows) {
        mapped[row.rowKey] ??= {}
        mapped[row.rowKey][row.calculationId] = row.calculatedValue
      }

      return { mapped, rows }
    },
  })
}
