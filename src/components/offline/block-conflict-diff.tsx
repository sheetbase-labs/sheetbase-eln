'use client'

import { t } from '#/copy'
import * as React from 'react'

import { diffWords } from '#/lib/text-diff'
import type {
  OfflineBlockPayloadEdit,
  OfflineReplayPort,
} from '#/lib/offline/replay'
import { blockPayloadSummary } from './offline-edit-model'

/**
 * What differs between the version saved by someone else and the one made
 * offline, as one flowing text: words only in the saved version are struck
 * through, words only in yours are highlighted.
 */
export function BlockConflictDiff({
  edit,
  port,
}: {
  edit: OfflineBlockPayloadEdit
  port: OfflineReplayPort
}) {
  const [saved, setSaved] = React.useState<string | null | undefined>(undefined)
  React.useEffect(() => {
    let active = true
    const read = port.readServerBlockPayload

    if (!read) {
      setSaved(null)

      return
    }

    void read(edit).then((payload) => {
      if (active) setSaved(payload ? blockPayloadSummary(payload) : null)
    })

    return () => {
      active = false
    }
  }, [edit, port])

  if (saved === undefined) return null

  if (saved === null) {
    return (
      <span className="text-fg-muted">
        {t('notebook.offlineReplay.nothingToShow')}
      </span>
    )
  }

  const parts = diffWords(saved, blockPayloadSummary(edit.payload))

  return (
    <span className="flex flex-col gap-1">
      <span
        data-offline-diff
        className="max-h-48 overflow-y-auto whitespace-pre-wrap"
      >
        {parts.map((part, index) =>
          part.kind === 'same' ? (
            <React.Fragment key={index}>{part.text}</React.Fragment>
          ) : part.kind === 'removed' ? (
            <del key={index} className="bg-danger-wash text-danger-text">
              {part.text}
            </del>
          ) : (
            <ins
              key={index}
              className="bg-success-wash text-success-text no-underline"
            >
              {part.text}
            </ins>
          ),
        )}
      </span>
      <span className="text-fg-muted">
        {t('notebook.offlineReplay.diffLegend')}
      </span>
    </span>
  )
}
