import { useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { toast } from '#/components/v3/ui/sonner'
import { requestInstrumentQualification } from '#/lib/instrument-qualification-requests'
import { notebookDataClient } from '#/lib/notebook-data'
import { t } from '#/copy'

/**
 * Ask the workspace owners to qualify the signed-in person on an instrument.
 * Pressing it again while a request is open is harmless, but the button says
 * the request is with the owners instead of inviting a second press.
 */
export function RequestQualificationButton({
  instrumentId,
  instrumentName,
  alreadyRequested = false,
  onRequested,
  size = 'sm',
}: {
  instrumentId: string
  instrumentName: string
  /** An open request from this person is already known to the caller. */
  alreadyRequested?: boolean
  /** Called once the request is recorded, e.g. to refresh a request list. */
  onRequested?: () => void
  size?: 'sm' | 'md'
}) {
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)

  async function request() {
    setPending(true)
    try {
      await requestInstrumentQualification(notebookDataClient, { instrumentId })
      setSent(true)
      onRequested?.()
      toast(
        t(
          'library.instruments.requestQualificationButton.qualificationRequested',
        ),
        {
          description: t(
            'library.instruments.requestQualificationButton.theWorkspaceOwnersHaveBeen',
            { instrumentName },
          ),
        },
      )
    } catch (error) {
      toast(
        t(
          'library.instruments.requestQualificationButton.couldNotRequestTheQualification',
        ),
        {
          description:
            error instanceof Error
              ? error.message
              : t(
                  'library.instruments.requestQualificationButton.theDatabaseRefusedIt',
                ),
        },
      )
    } finally {
      setPending(false)
    }
  }

  if (alreadyRequested || sent) {
    return (
      <Button size={size} disabled>
        {t(
          'library.instruments.requestQualificationButton.qualificationRequested',
        )}
      </Button>
    )
  }
  return (
    <Button size={size} disabled={pending} onClick={() => void request()}>
      {pending
        ? t('library.instruments.requestQualificationButton.requesting')
        : t(
            'library.instruments.requestQualificationButton.requestQualification',
          )}
    </Button>
  )
}
