import { Link } from '@tanstack/react-router'
import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { t } from '#/copy'

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
    title: t('library.instruments.intakeDeliveryNotice.theLastImportFailed'),
    body: t('library.instruments.intakeDeliveryNotice.theMostRecentFileDid'),
  },
  stale: {
    title: t('library.instruments.intakeDeliveryNotice.noRecentData'),
    body: t(
      'library.instruments.intakeDeliveryNotice.nothingHasBeenImportedFrom',
    ),
  },
  waiting: {
    title: t('library.instruments.intakeDeliveryNotice.waitingForFirstData'),
    body: t(
      'library.instruments.intakeDeliveryNotice.dataReachesThisInstrumentsRecord',
    ),
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
  onSetUp,
}: {
  instrumentId: string
  instrumentName: string
  problem: Problem
  canImport: boolean
  /** Offered when the instrument has no data intake set up yet. */
  onSetUp?: () => void
}) {
  const copy = COPY[problem]
  return (
    <Notice
      tone={problem === 'failed' ? 'bad' : 'warn'}
      title={copy.title}
      action={
        onSetUp || canImport ? (
          <span className="flex flex-wrap gap-2">
            {onSetUp ? (
              <Button size="sm" variant="primary" onClick={onSetUp}>
                {t('library.instruments.intakeDeliveryNotice.setUpIntake')}
              </Button>
            ) : null}
            {canImport ? (
              <Button
                size="sm"
                nativeButton={false}
                render={
                  <Link to="/import" search={{ instrument: instrumentId }} />
                }
              >
                {t('library.instruments.intakeDeliveryNotice.uploadAFile')}
              </Button>
            ) : null}
          </span>
        ) : undefined
      }
    >
      {instrumentName}: {copy.body}
      {canImport
        ? ''
        : t('library.instruments.intakeDeliveryNotice.askAWorkspaceMemberWith')}
    </Notice>
  )
}
