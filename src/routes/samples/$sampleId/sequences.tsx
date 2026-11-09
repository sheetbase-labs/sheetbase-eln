import { createFileRoute } from '@tanstack/react-router'

import { SequencePanel } from '#/components/sequence'
import { hasCapability } from '#/lib/capability'
import { useSampleRecord } from '../$sampleId'

/**
 * The sample's Sequences tab: the GenBank and FASTA files linked to it, each
 * opening as a circular or linear map with its features.
 */
export const Route = createFileRoute('/samples/$sampleId/sequences')({
  component: SampleSequences,
})

function SampleSequences() {
  const { sampleId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const sample = useSampleRecord(sampleId)

  if (!sample.data) return null

  return (
    <SequencePanel
      recordId={sample.data.id}
      projectId={sample.data.projectId}
      canEdit={hasCapability(context.workspace?.role, 'record.create')}
    />
  )
}
