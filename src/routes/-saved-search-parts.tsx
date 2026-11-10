import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Field, Input } from '#/components/ui/input'
import { t } from '#/copy'
import type { SavedQuery } from '#/lib/search'

/**
 * The parts of the Saved searches page that own their own markup: the row
 * actions menu and the two confirmation dialogs. The page keeps the list, the
 * filters and the write state, so each part stays a plain view of what it is
 * given.
 */

/** The row menu: rename, share or stop sharing, delete. */
export function SavedSearchActions({
  search,
  canShare,
  onRename,
  onShare,
  onStopSharing,
  onDelete,
}: {
  search: SavedQuery
  canShare: boolean
  onRename: (search: SavedQuery) => void
  onShare: (search: SavedQuery) => void
  onStopSharing: (search: SavedQuery) => void
  onDelete: (search: SavedQuery) => void
}) {
  const shared = search.visibility === 'workspace'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="sm"
            variant="quiet"
            aria-label={t('projects.savedSearches.actionsLabel', {
              name: search.name,
            })}
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <Icon name="more" size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onRename(search)}>
          {t('common.actions.rename')}
        </DropdownMenuItem>
        {shared ? (
          <DropdownMenuItem onClick={() => onStopSharing(search)}>
            {t('projects.savedSearches.stopSharing')}
          </DropdownMenuItem>
        ) : canShare ? (
          <DropdownMenuItem onClick={() => onShare(search)}>
            {t('projects.savedSearches.shareWithWorkspace')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem danger onClick={() => onDelete(search)}>
          {t('common.actions.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Rename one saved search; the typed name is held by the page. */
export function RenameSavedSearchDialog({
  search,
  name,
  pending,
  onNameChange,
  onClose,
  onSubmit,
}: {
  search: SavedQuery | null
  name: string
  pending: boolean
  onNameChange: (name: string) => void
  onClose: () => void
  onSubmit: (input: { id: string; name: string }) => void
}) {
  return (
    <Dialog
      open={search !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader title={t('projects.savedSearches.renameTitle')} />
        <form
          onSubmit={(e) => {
            e.preventDefault()

            if (!search || !name.trim()) return
            onSubmit({ id: search.id, name })
          }}
        >
          <DialogBody>
            <Field label={t('projects.savedSearches.name')}>
              <Input
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                autoFocus
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              type="submit"
              variant="primary"
              disabled={!name.trim() || pending}
            >
              {t('common.actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Confirm deleting one saved search. */
export function DeleteSavedSearchDialog({
  search,
  onClose,
  onConfirm,
}: {
  search: SavedQuery | null
  onClose: () => void
  onConfirm: (search: SavedQuery) => void
}) {
  return (
    <ConfirmDialog
      open={search !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {search
              ? search.visibility === 'workspace'
                ? t('projects.savedSearches.deleteShared', {
                    name: search.name,
                  })
                : t('projects.savedSearches.deleteOwn', {
                    name: search.name,
                  })
              : ''}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {t('projects.savedSearches.deleteBody')}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel>
            {t('common.actions.cancel')}
          </ConfirmDialogCancel>
          <ConfirmDialogAction
            variant="danger-fill"
            onClick={() => search && onConfirm(search)}
          >
            {t('common.actions.delete')}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}
