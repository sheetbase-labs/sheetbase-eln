import { Link } from '@tanstack/react-router'
import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'

type Problem = 'failed' | 'stale' | 'waiting'

/** Which delivery problem an `intakeHealth` label describes, if any. */
export function intakeDeliveryProblem(label: string): Problem | null {
  if (label === 'Last import failed') return 'failed'
  if (label.startsWith('No data for')) return 'stale'
  if (label === 'Waiting for first data') return 'waiting'
  return null
}

const COPY: Record<Problem, { title: string; body: string }> = {
  failed: {
    title: 'The last import failed.',
    body: 'The most recent file did not import, so nothing new from this instrument is in a Dataset. Upload the export again to retry; the import page shows what was wrong with it.',
  },
  stale: {
    title: 'No recent data.',
    body: 'Nothing has been imported from this instrument for a while. Imports in this workspace happen by file upload. If the instrument should be sending files on its own, ask a workspace admin to check its connection.',
  },
  waiting: {
    title: 'Waiting for first data.',
    body: 'Data reaches this instrument’s record when someone uploads one of its exports on the import page. Once the first import is committed this reads Healthy.',
  },
}

/**
 * Why an automated instrument isn't delivering data and the real next step. The
 * only intake in this deployment is browser upload, so the action is an upload
 * with this instrument already chosen.
 */
export function IntakeDeliveryNotice({
  instrumentId,
  instrumentName,
  problem,
  canImport,
}: {
  instrumentId: string
  instrumentName: string
  problem: Problem
  canImport: boolean
}) {
  const copy = COPY[problem]
  return (
    <Notice
      tone={problem === 'failed' ? 'bad' : 'warn'}
      title={copy.title}
      action={
        canImport ? (
          <Button
            size="sm"
            nativeButton={false}
            render={<Link to="/import" search={{ instrument: instrumentId }} />}
          >
            Upload a file
          </Button>
        ) : undefined
      }
    >
      {instrumentName}: {copy.body}
      {canImport
        ? ''
        : ' Ask a workspace member with write access (any role except viewer) to upload it.'}
    </Notice>
  )
}
