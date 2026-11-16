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
import { Button } from '#/components/ui/button'
import { Icon } from '#/components/icons'
import { ESignDialog } from '#/components/notebook/e-sign-dialog'
import { PreSignSummary } from '#/components/review/pre-sign-summary'
import type { PreSignInput } from '#/components/review/pre-sign-summary'
import type { RevisionWire } from '#/lib/notebook-data'
import type { PostSubmissionSignatureMeaning } from '#/lib/signatures'
import { t } from '#/copy'

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
  preSign,
  approving = false,
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
  /** What changed and what to double-check; shown above the form. */
  preSign?: PreSignInput | null
  /** Approving and signing in this one dialog: the words say so. */
  approving?: boolean
  onConfirm: (
    meaning: PostSubmissionSignatureMeaning,
    confirmation: string,
    password: string,
  ) => void
}) {
  // After approval the signature that locks the record is "reviewed and
  // approved", so that is the one offered first; a plain "reviewed" signature
  // does not lock it and is a deliberate choice.
  const initialMeaning =
    requestedMeaning && meanings.includes(requestedMeaning)
      ? requestedMeaning
      : meanings.includes('reviewed-and-approved')
        ? 'reviewed-and-approved'
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
        title={
          approving
            ? t('projects.signDialog.approveTitle')
            : t('projects.signDialog.title')
        }
        description={
          <>
            {approving ? t('projects.signDialog.approveDescription') : null}{' '}
            {t('projects.signDialog.description')}
            {revision.reason ? (
              <>
                {' '}
                {t('projects.signDialog.reason', { reason: revision.reason })}
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
        beforeYouSign={preSign ? <PreSignSummary input={preSign} /> : undefined}
        onSubmit={({ meaning, confirmation, password }) =>
          onConfirm(meaning, confirmation, password)
        }
      />
    </>
  )
}
