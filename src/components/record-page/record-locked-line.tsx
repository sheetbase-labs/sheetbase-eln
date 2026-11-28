import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { AmendNotebookDialog } from '#/components/notebook/amend-notebook-dialog'
import { Button } from '#/components/ui/button'
import { formatDate } from '#/lib/format-date'
import { notebookQueryKeys } from '#/lib/notebook-data'
import { t } from '#/copy'

import { RecordStateLine } from './record-state-line'

/**
 * A record locked by its approval says so once, in the page's state line,
 * with the way to change it: an amendment, which unlocks it for editing.
 */
export function RecordLockedLine({
  recordId,
  lockedAt,
  canAmend,
  onAmended,
}: {
  recordId: string
  lockedAt: string
  canAmend: boolean
  /** Anything else the page reads about the record that the amendment changes. */
  onAmended?: () => void
}) {
  const [amending, setAmending] = useState(false)
  const queryClient = useQueryClient()

  return (
    <>
      <RecordStateLine
        tone="info"
        action={
          canAmend ? (
            <Button size="sm" onClick={() => setAmending(true)}>
              {t('notebook.recordPage.amend')}
            </Button>
          ) : null
        }
      >
        {t('notebook.recordPage.lockedLine', { date: formatDate(lockedAt) })}
      </RecordStateLine>
      {canAmend ? (
        <AmendNotebookDialog
          open={amending}
          onOpenChange={setAmending}
          recordId={recordId}
          onAmended={async () => {
            await queryClient.invalidateQueries({
              queryKey: notebookQueryKeys.record(recordId),
            })
            await queryClient.invalidateQueries({
              queryKey: notebookQueryKeys.blocks(recordId),
            })
            onAmended?.()
          }}
        />
      ) : null}
    </>
  )
}
