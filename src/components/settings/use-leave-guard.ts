import { usePendingEdit } from '#/lib/pending-edits'
import { usePaneContext } from '#/components/workspace/workspace-navigation'

/**
 * Asks Save, Discard or Cancel when a settings form with unsaved edits is
 * left, so typed changes are never lost by following a link. `save` resolves
 * true once the edits are stored; `discard` puts the form back to what is
 * saved. Pass `canSave: false` while the form has a problem Save would refuse.
 */
export function useLeaveGuard({
  dirty,
  label,
  canSave = true,
  save,
  discard,
}: {
  dirty: boolean
  label: string
  canSave?: boolean
  save: () => Promise<boolean>
  discard: () => void
}) {
  const paneId = usePaneContext().paneId

  usePendingEdit({
    dirty,
    label,
    paneId,
    save: async () => canSave && (await save()),
    discard,
  })
}
