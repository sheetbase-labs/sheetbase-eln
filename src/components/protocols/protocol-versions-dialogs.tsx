/**
 * The four dialogs the versions panel can show: submit a version, approve it,
 * return it, or withdraw it. Apart from the panel so that file holds only the
 * component and the table.
 */
import { useState } from 'react'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field } from '#/components/ui/input'
import { Textarea } from '#/components/inventory/list'
import { ReasonDialog } from '#/components/models/model-approval-panel'
import type { ProtocolVersion } from '#/lib/controlled-protocols'
import { t } from '#/copy'
import type { RowDialog } from './protocol-versions'

/** What the panel's dialogs need from it: the open one, and what each answer does. */
export interface VersionDialogsProps {
  dialog: RowDialog | null
  busy: boolean
  /** The approval request the open dialog answers, when it answers one. */
  pendingRequestId: string | null
  onClose: () => void
  onSubmit: (summary: string, resume: ProtocolVersion | undefined) => void
  onApprove: (reason: string) => void
  onReturn: (reason: string) => void
  onWithdraw: (reason: string) => void
}

export function VersionDialogs({
  dialog,
  busy,
  onClose,
  onSubmit,
  onApprove,
  onReturn,
  onWithdraw,
}: VersionDialogsProps) {
  const versionLabel =
    dialog && dialog.kind !== 'submit' ? String(dialog.version.version) : ''

  return (
    <>
      <SubmitDialog
        open={dialog?.kind === 'submit'}
        busy={busy}
        resume={dialog?.kind === 'submit' ? dialog.resume : undefined}
        onOpenChange={(open) => !open && onClose()}
        onSubmit={(summary) =>
          onSubmit(
            summary,
            dialog?.kind === 'submit' ? dialog.resume : undefined,
          )
        }
      />
      <ReasonDialog
        open={dialog?.kind === 'approve'}
        busy={busy}
        title={t('library.protocols.protocolVersionsPanel.approveV', {
          version: versionLabel,
        })}
        description={t(
          'library.protocols.protocolVersionsPanel.yourRoleAndIndependenceAre',
        )}
        label={t('library.protocols.protocolVersionsPanel.noteOptional')}
        required={false}
        confirmLabel={t('library.protocols.protocolVersionsPanel.approve')}
        onOpenChange={(open) => !open && onClose()}
        onConfirm={onApprove}
      />
      <ReasonDialog
        open={dialog?.kind === 'return'}
        busy={busy}
        title={t('library.protocols.protocolVersionsPanel.returnV', {
          version: versionLabel,
        })}
        description={t(
          'library.protocols.protocolVersionsPanel.theAuthorSeesYourReason',
        )}
        label={t('library.protocols.protocolVersionsPanel.reasonForReturning')}
        required
        confirmLabel={t(
          'library.protocols.protocolVersionsPanel.returnForChanges',
        )}
        onOpenChange={(open) => !open && onClose()}
        onConfirm={onReturn}
      />
      <ReasonDialog
        open={dialog?.kind === 'withdraw'}
        busy={busy}
        title={t('library.protocols.protocolVersionsPanel.withdrawV', {
          version: versionLabel,
        })}
        description={t(
          'library.protocols.protocolVersionsPanel.theVersionStopsWaitingFor',
        )}
        label={t('library.protocols.protocolVersionsPanel.reasonOptional')}
        required={false}
        confirmLabel={t('library.protocols.protocolVersionsPanel.withdraw')}
        onOpenChange={(open) => !open && onClose()}
        onConfirm={onWithdraw}
      />
    </>
  )
}

function SubmitDialog({
  open,
  busy,
  resume,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  busy: boolean
  resume?: ProtocolVersion
  onOpenChange: (open: boolean) => void
  onSubmit: (summary: string) => void
}) {
  const [summary, setSummary] = useState('')
  const text = summary.trim() || resume?.change_summary || ''

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSummary('')
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={
            resume
              ? t(
                  'library.protocols.protocolVersionsPanel.submitVForApproval',
                  { version: resume.version },
                )
              : t('library.protocols.protocolVersionsPanel.submitANewVersion')
          }
          description={
            resume
              ? t(
                  'library.protocols.protocolVersionsPanel.thisVersionsTextIsAlready',
                )
              : t(
                  'library.protocols.protocolVersionsPanel.theProtocolsCurrentTextIs',
                )
          }
        />
        <DialogBody>
          <Field
            label={t('library.protocols.protocolVersionsPanel.whatChanged')}
            required
          >
            <Textarea
              value={summary}
              rows={3}
              maxLength={500}
              disabled={busy}
              placeholder={
                resume?.change_summary ||
                t('library.protocols.protocolVersionsPanel.whatChangedAndWhyIt')
              }
              onChange={(event) => setSummary(event.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!text || busy}
            onClick={() => onSubmit(text)}
          >
            {busy
              ? t('library.protocols.protocolVersionsPanel.submitting')
              : t('library.protocols.protocolVersionsPanel.submitForApproval')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
