import { createFileRoute } from '@tanstack/react-router'
import { ExperimentHistory } from '#/components/audit/experiment-history'
import { useExperimentRecord } from '../$expId'

export const Route = createFileRoute('/experiments/$expId/history')({
  component: History,
})

function History() {
  const { expId } = Route.useParams()
  const record = useExperimentRecord(expId)
  return (
    <ExperimentHistory
      recordId={expId}
      identifier={record.data?.identifier ?? expId}
    />
  )
}
