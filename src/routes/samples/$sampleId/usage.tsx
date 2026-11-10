import { createFileRoute } from '@tanstack/react-router'

import { UsageBalanceBar } from '#/components/samples/sample-usage'
import { useSampleActions } from '#/components/samples/quantity-actions'

import { useSampleUsage } from './-sample-usage-data'
import { LinkedExperimentsSection, UsageSection } from './-sample-usage-table'

/**
 * LAB-01 step 3 — the sample Usage tab (SampleUsage).
 *
 * Everything here is read from canonical data: the used / reserved / free bar
 * comes from `api.sample_quantity_balances`, the reservations from
 * `api.sample_reservations` and the withdrawal rows from the `consume` rows of
 * `api.sample_events`. The design shows withdrawals and planned reservations in
 * one table, so both are merged here (a reservation is labelled "Planned"),
 * with the Volume bar beneath it. The Withdraw and Reserve buttons open the
 * dialogs the sample frame owns.
 */
export const Route = createFileRoute('/samples/$sampleId/usage')({
  component: SampleUsage,
})

function SampleUsage() {
  const { sampleId } = Route.useParams()
  const actions = useSampleActions()
  const usage = useSampleUsage(sampleId)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <UsageSection
        rows={usage.rows}
        rowCount={usage.rowCount}
        experimentById={usage.experimentById}
        actions={actions}
        cancelling={usage.cancelling}
      />

      <LinkedExperimentsSection
        experiments={usage.linkedExperiments.data ?? []}
      />

      <UsageBalanceBar balances={usage.balances.data ?? null} />
    </div>
  )
}
