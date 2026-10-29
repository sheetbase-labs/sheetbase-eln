/**
 * R5-NOTE-02 — the review workspace's signing entry point.
 *
 * The review route's SignaturePanel renders this; it is a thin wrapper over the
 * one shared `ESignDialog`, so the step-up (`purpose: 'sign'`) and the
 * `sign_revision` write stay in the route's `handleSigned` and the dialog owns
 * only the entered meaning, confirmation and password. Kept as a component file
 * (rather than an inline function in the route) so the review signing flow has
 * its own regression test without mounting the whole workspace.
 */
import { Button } from '#/components/v3/ui/button'
import { Icon } from '#/components/v3/icons'
import { ESignDialog } from '#/components/notebook/e-sign-dialog'
import type { RevisionWire } from '#/lib/notebook-data'
import type { PostSubmissionSignatureMeaning } from '#/lib/signatures'
import { rich, t } from '#/copy'

export function SignatureDialog({
  open,
  onOpenChange,
  revision,
  integrityDigest,
  meanings,
  requestedMeaning,
  currentUserName,
  signing,
  error,
  cancelLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  revision: RevisionWire
  integrityDigest: string | null
  meanings: PostSubmissionSignatureMeaning[]
  requestedMeaning?: PostSubmissionSignatureMeaning
  currentUserName: string
  signing: boolean
  error: string | null
  /** What leaving without signing is called, e.g. "Sign later". */
  cancelLabel?: string
  onConfirm: (
    meaning: PostSubmissionSignatureMeaning,
    confirmation: string,
    password: string,
  ) => void
}) {
  const initialMeaning =
    requestedMeaning && meanings.includes(requestedMeaning)
      ? requestedMeaning
      : (meanings[0] ?? 'reviewed-and-approved')
  return (
    <>
      <Button className="w-full" onClick={() => onOpenChange(true)}>
        <Icon name="edit" size={14} aria-hidden />
        {t('projects.signDialog.trigger')}
      </Button>
      <ESignDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('projects.signDialog.title')}
        description={
          <>
            {rich('projects.signDialog.description', {
              id: <span className="font-mono">{revision.id.slice(0, 8)}</span>,
            })}
            {revision.reason ? (
              <>
                {' '}
                {rich('projects.signDialog.reason', {
                  reason: <span className="font-mono">{revision.reason}</span>,
                })}
              </>
            ) : null}
          </>
        }
        signingAs={currentUserName}
        subject={{ revisionId: revision.id, digest: integrityDigest }}
        meanings={meanings}
        initialMeaning={initialMeaning}
        busy={signing}
        errorMessage={error}
        cancelLabel={cancelLabel}
        onSubmit={({ meaning, confirmation, password }) =>
          onConfirm(meaning, confirmation, password)
        }
      />
    </>
  )
}
