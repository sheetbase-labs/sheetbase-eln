/**
 * The Snapshots tab's two write confirmations: "Save a snapshot now" and
 * "Keep" a snapshot from retention. Each takes itself out of the document the
 * moment its caller records the write, so neither can be submitted twice.
 */
import { useState } from 'react'
import type { DialogRootActions } from '@base-ui/react/dialog'

import { t } from '#/copy'
import { Notice } from '#/components/ui/alert'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'
import type { SnapshotVersion } from '#/components/datasets/snapshot-data'

interface CreateSnapshotDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actionsRef: React.RefObject<DialogRootActions | null>
  defaultLabel: string
  busy?: boolean
  onSubmit: (label: string) => void
}

/**
 * "Save a snapshot now" dialog. A label is required so the snapshot list and
 * comparison stay readable; the value is trimmed by the product helper before
 * it reaches the RPC. `actionsRef` lets the caller take the dialog out of the
 * document the moment the snapshot is saved, so the confirmation cannot be
 * submitted twice.
 */
export function CreateSnapshotDialog({
  open,
  onOpenChange,
  actionsRef,
  defaultLabel,
  busy = false,
  onSubmit,
}: CreateSnapshotDialogProps) {
  const formId = 'create-snapshot'
  const [label, setLabel] = useState(defaultLabel)
  const [touched, setTouched] = useState(false)
  const trimmed = label.trim()
  const invalid = trimmed.length === 0

  return (
    <Dialog
      open={open}
      actionsRef={actionsRef}
      onOpenChange={(next) => {
        if (!next) {
          setLabel(defaultLabel)
          setTouched(false)
        }

        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(460px,calc(100vw-32px))]">
        <DialogHeader
          title={t('data.datasetSnapshots.createSnapshot')}
          description={t('data.datasetSnapshots.freezeDatasetSCurrent')}
        />
        <DialogBody>
          <Notice tone="info" icon={false}>
            {t('data.datasetSnapshots.snapshotNeverChangesLater')}
          </Notice>
          <form
            id={formId}
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()

              if (!invalid) onSubmit(trimmed)
            }}
          >
            <Field
              label={t('data.datasetSnapshots.label')}
              required
              error={
                touched && invalid
                  ? t('data.datasetSnapshots.enterLabel')
                  : undefined
              }
              hint={t('data.datasetSnapshots.shownSnapshotListComparison')}
            >
              <Input
                value={label}
                autoFocus
                required
                disabled={busy}
                aria-invalid={touched && invalid}
                onChange={(e) => {
                  setLabel(e.target.value)
                  setTouched(true)
                }}
              />
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={busy || invalid}
          >
            {t('data.datasetSnapshots.saveSnapshot')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface KeepSnapshotDialogProps {
  snapshot: SnapshotVersion | null
  onOpenChange: (open: boolean) => void
  actionsRef: React.RefObject<DialogRootActions | null>
  busy?: boolean
  onSubmit: (reason: string) => void
}

const KEEP_REASON_MAX = 500

/**
 * DSET-04.3 — "Keep" a snapshot from retention. A reason is required because
 * the RPC stores it beside the snapshot and rejects an empty one; the value
 * is trimmed and length-checked here so the refusal never reaches the user as
 * a raw database error. Like the create dialog, it is unmounted by its caller
 * once the keep is recorded, so it cannot be submitted a second time.
 */
export function KeepSnapshotDialog({
  snapshot,
  onOpenChange,
  actionsRef,
  busy = false,
  onSubmit,
}: KeepSnapshotDialogProps) {
  const formId = 'keep-snapshot'
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const trimmed = reason.trim()
  const invalid = trimmed.length < 1 || trimmed.length > KEEP_REASON_MAX

  return (
    <Dialog
      open={snapshot !== null}
      actionsRef={actionsRef}
      onOpenChange={(next) => {
        if (!next) {
          setReason('')
          setTouched(false)
        }

        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(460px,calc(100vw-32px))]">
        <DialogHeader
          title={
            snapshot
              ? t('data.datasetSnapshots.keep', { label: snapshot.label })
              : t('data.datasetSnapshots.keepSnapshot')
          }
          description={t('data.datasetSnapshots.retentionRemoveSnapshotS')}
        />
        <DialogBody>
          <Notice tone="info" icon={false}>
            {t('data.datasetSnapshots.keepingRecordsWhyRows')}
          </Notice>
          <form
            id={formId}
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()

              if (!invalid) onSubmit(trimmed)
            }}
          >
            <Field
              label={t('data.datasetSnapshots.reason')}
              required
              error={
                touched && invalid
                  ? t('data.datasetSnapshots.enterReasonUpCharacters', {
                      KEEP_REASON_MAX,
                    })
                  : undefined
              }
              hint={t('data.datasetSnapshots.storedSnapshotShownHistory')}
            >
              <Input
                value={reason}
                autoFocus
                disabled={busy}
                maxLength={KEEP_REASON_MAX}
                aria-invalid={touched && invalid}
                onChange={(e) => {
                  setReason(e.target.value)
                  setTouched(true)
                }}
                placeholder={t(
                  'data.datasetSnapshots.placeholderEGStillNeeded',
                )}
              />
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={busy || invalid}
          >
            {busy
              ? t('data.datasetSnapshots.keeping2')
              : t('data.datasetSnapshots.keepSnapshot')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
