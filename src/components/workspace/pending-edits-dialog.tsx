import { useState } from 'react'

import { Button } from '#/components/ui/button'
import {
  ConfirmDialog,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import { Spinner } from '#/components/ui/spinner'
import { t } from '#/copy'
import type { PendingEdit } from '#/lib/pending-edits'

/**
 * Asked when a pane with unsaved edits is closed or left: Save keeps them,
 * Discard throws them away, Cancel stays on the page.
 */
export function PendingEditsDialog({
  edits,
  onResolve,
}: {
  edits: PendingEdit[] | null
  onResolve: (leave: boolean) => void
}) {
  const [saving, setSaving] = useState(false)
  const label = edits?.map((edit) => edit.label).join(', ') ?? ''

  async function save() {
    if (!edits) return
    setSaving(true)

    try {
      for (const edit of edits) {
        if (!(await edit.save())) return
      }

      onResolve(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConfirmDialog
      open={edits !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onResolve(false)
      }}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {t('projects.panePage.title')}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {t('projects.panePage.body', { label })}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <Button disabled={saving} onClick={() => onResolve(false)}>
            {t('common.actions.cancel')}
          </Button>
          <Button
            disabled={saving}
            onClick={() => {
              for (const edit of edits ?? []) edit.discard()
              onResolve(true)
            }}
          >
            {t('common.actions.discard')}
          </Button>
          <Button
            variant="primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? <Spinner size={16} /> : null}
            {t('common.actions.save')}
          </Button>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}
