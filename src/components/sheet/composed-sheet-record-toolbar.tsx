import { t } from '#/copy'
import { PresenceStack } from '#/components/collaboration/presence-avatars'
import { RemoteSelectionChips } from '#/components/collaboration/presence-selection-chips'

import type { ResolvedSheetRecordAction } from '#/lib/sheet-record-actions'
import type { SheetRecordGridError } from '#/lib/sheet-record-grid-errors'
import { Button } from '#/components/ui/button'

export function ComposedSheetRecordToolbar({
  actions,
  errors,
  onLink,
  onCreate,
  onValidate,
  onCommit,
  onNextError,
}: {
  actions: ResolvedSheetRecordAction[]
  errors: SheetRecordGridError[]
  onLink: () => void
  onCreate: () => void
  onValidate: () => void
  onCommit: () => void
  onNextError: () => void
}) {
  const link = actions.find((action) => action.kind === 'link-record')
  const create = actions.find((action) => action.kind === 'create-record')
  // Record buttons appear only when the sheet's setup turns them on. A sheet
  // that only shows a dataset keeps the plain header the design draws.
  const recordActions = Boolean(link?.enabled || create?.enabled)

  if (!recordActions && errors.length === 0)
    return (
      // Who is here already shows in the page header; only other people's
      // selections earn a line, and only while there are some.
      <div className="flex items-center justify-end gap-2 border-b px-3 py-2 empty:hidden">
        <RemoteSelectionChips />
      </div>
    )

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      {link?.enabled ? (
        <Button type="button" size="sm" onClick={onLink}>
          {link.label}
        </Button>
      ) : null}
      {create?.enabled ? (
        <Button type="button" size="sm" onClick={onCreate}>
          {create.label}
        </Button>
      ) : null}
      {recordActions ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onValidate}
          >
            {t('notebook.composedSheetRecordToolbar.validate')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onCommit}
          >
            {t('notebook.composedSheetRecordToolbar.commit')}
          </Button>
        </>
      ) : null}
      {errors.length > 0 ? (
        <Button type="button" size="sm" variant="quiet" onClick={onNextError}>
          {t('notebook.composedSheetRecordToolbar.nextErrorCount', {
            count: errors.length,
          })}
        </Button>
      ) : null}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* COLLAB-01 awareness: remote selections and who else is here. Both
            self-gate on room readiness and render nothing outside a room. */}
        <RemoteSelectionChips />
        <PresenceStack />
      </div>
    </div>
  )
}
