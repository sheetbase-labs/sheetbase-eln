import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { toast } from '#/components/ui/sonner'
import {
  publishNotebookTemplateVersion,
  retireNotebookTemplateVersion,
} from '#/lib/notebook-template-data'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import { errorMessage, isStaleRevisionError } from './-versions-data'
import { t } from '#/copy'

/**
 * Publish or retire one template version: the reason, and for a retire the
 * e-signature meaning. A stale draft becomes a reload prompt, not a failure.
 */
export function GovernanceDialog({
  kind,
  version,
  onClose,
  onDone,
  onStale,
}: {
  kind: 'publish' | 'retire'
  version: NotebookTemplateVersion
  onClose: () => void
  onDone: () => void
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The refusal the screen reports comes from a caught throw, so it reaches this callback untyped.
  onStale: (version: NotebookTemplateVersion, error: unknown) => void
}) {
  const [reason, setReason] = useState('')

  const [meaning, setMeaning] = useState(() =>
    t('library.templates.versions.retiredNoLongerForNew'),
  )

  const [error, setError] = useState<string | null>(null)

  const publish = useMutation({
    mutationFn: () =>
      publishNotebookTemplateVersion(
        version.id,
        version.revision,
        reason.trim(),
      ),
    onSuccess: () => {
      toast(
        t('library.templates.versions.vPublished', {
          version: version.version,
        }),
        {
          description: t('library.templates.versions.newNotebooksCanStartFrom'),
        },
      )
      onDone()
    },
    onError: (e) => {
      if (isStaleRevisionError(e)) {
        onStale(version, e)

        return
      }

      setError(errorMessage(e))
    },
  })

  const retire = useMutation({
    mutationFn: () =>
      retireNotebookTemplateVersion(
        version.id,
        version.revision,
        reason.trim(),
        meaning.trim(),
      ),
    onSuccess: () => {
      toast(
        t('library.templates.versions.vRetired', { version: version.version }),
      )
      onDone()
    },
    onError: (e) => {
      if (isStaleRevisionError(e)) {
        onStale(version, e)

        return
      }

      setError(errorMessage(e))
    },
  })

  const busy = publish.isPending || retire.isPending

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={
            kind === 'publish'
              ? t('library.templates.versions.publishV2', {
                  version: version.version,
                })
              : t('library.templates.versions.retireV2', {
                  version: version.version,
                })
          }
          description={
            kind === 'publish'
              ? t(
                  'library.templates.versions.publishingMakesThisVersionAvailable',
                )
              : t('library.templates.versions.retiringIsAnESignature')
          }
        />
        <DialogBody>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <Field
            label={t('library.templates.versions.reasonForChange')}
            required
          >
            <Input
              autoFocus
              value={reason}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setReason(e.target.value)
                setError(null)
              }}
              placeholder={t('library.templates.versions.eGAddsTheStability')}
            />
          </Field>
          {kind === 'retire' ? (
            <Field
              label={t('library.templates.versions.signatureMeaning')}
              required
              hint={t('library.templates.versions.youMustHaveCertifiedYour')}
            >
              <Input
                value={meaning}
                onChange={(e) => setMeaning(e.target.value)}
              />
            </Field>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant={kind === 'retire' ? 'danger' : 'primary'}
            disabled={busy || reason.trim().length < 1}
            onClick={() => {
              setError(null)

              if (reason.trim().length < 1) {
                setError(t('library.templates.versions.giveAReasonForThe'))

                return
              }

              if (kind === 'publish') publish.mutate()
              else retire.mutate()
            }}
          >
            {busy
              ? t('common.states.saving')
              : kind === 'publish'
                ? t('library.templates.versions.publishV2', {
                    version: version.version,
                  })
                : t('library.templates.versions.signAndRetireV', {
                    version: version.version,
                  })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
