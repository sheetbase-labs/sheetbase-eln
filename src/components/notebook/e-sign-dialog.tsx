/**
 * R5-NOTE-02 — the single electronic-signature dialog.
 *
 * Before this, signing had two near-identical dialogs (the Notebook's
 * `SignNotebookDialog` and the review workspace's `SignatureDialog`) plus the
 * certification surface. This is the one dialog they render, over the existing
 * REV-03 contract — it consumes that contract, it does not reimplement it:
 *
 * - the meanings and their attestation wording come from
 *   `SIGNATURE_MEANING_OPTIONS`;
 * - the assurance statement comes from `ASSURANCE_LEVEL_STATEMENT`;
 * - the password field is exactly the re-authentication the server performs —
 *   the dialog never verifies a credential itself;
 * - the signing time is shown as a fact about the server ("recorded as server
 *   time when you sign"), never a client clock value. `signedAt` is always DB
 *   `clock_timestamp()` inside `sign_revision` / `record_revision_signature`.
 *
 * The step-up request and the write stay with each flow, because their
 * `SignatureStepUpInput` payloads differ (`'sign'` for review and Notebook
 * signatures, `'author-submit'` for the authored signature). Those flows call
 * `requestSignatureStepUp` and then the RPC with the returned token; the dialog
 * hands them the entered meaning, confirmation and password and nothing else.
 *
 * Decision recorded (R5-NOTE-02): the design's dialog also collects a free-text
 * reason. A signature against a frozen revision already carries the revision's
 * own reason, and no ELN signing RPC accepts a separate reason, so the dialog
 * does not add one; the change dialogs that need a justification keep the
 * generic `ReasonDialog`. An owner may overrule and add a reason field here.
 */
import { t } from '#/copy'
import { useEffect, useRef, useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Select } from '#/components/v3/ui/select'
import {
  ASSURANCE_LEVEL_STATEMENT,
  SIGNATURE_MEANING_OPTIONS,
} from '#/lib/signatures'
import type { PostSubmissionSignatureMeaning } from '#/lib/signatures'

export interface ESignSubmitInput {
  meaning: PostSubmissionSignatureMeaning
  confirmation: string
  password: string
}

export interface ESignDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  /** The signer's recorded name, shown before any secret is entered. */
  signingAs: string
  /**
   * What is being signed. When present the revision and content digest are
   * shown and a signature cannot be submitted without the digest — the same
   * stale-action protection the RPC enforces.
   */
  subject?: { revisionId?: string | null; digest?: string | null }
  /** The meanings the server will accept for this signer right now. */
  meanings: readonly PostSubmissionSignatureMeaning[]
  /** Pre-selected meaning (e.g. a requested meaning from the review link). */
  initialMeaning?: PostSubmissionSignatureMeaning
  /** Require typing the signer's name; on by default. */
  requireConfirmation?: boolean
  /** Explanation shown instead of the form when signing is not available. */
  blocked?: React.ReactNode
  /** The flow's step-up + write is in flight. */
  busy?: boolean
  errorMessage?: string | null
  submitLabel?: string
  /** The label for the control that leaves without signing (default Cancel). */
  cancelLabel?: string
  onSubmit: (input: ESignSubmitInput) => void
}

export function ESignDialog({
  open,
  onOpenChange,
  title,
  description,
  signingAs,
  subject,
  meanings,
  initialMeaning,
  requireConfirmation = true,
  blocked,
  busy = false,
  errorMessage = null,
  submitLabel = t('notebook.eSignDialog.sign'),
  cancelLabel = t('common.actions.cancel'),
  onSubmit,
}: ESignDialogProps) {
  // `meanings` may be empty while eligibility loads; the selection still needs
  // a value, and the select renders only what the server accepts.
  const fallbackMeaning =
    meanings.length > 0 ? meanings[0] : 'reviewed-and-approved'
  const [meaning, setMeaning] = useState<PostSubmissionSignatureMeaning>(
    initialMeaning ?? fallbackMeaning,
  )
  const [confirmation, setConfirmation] = useState('')
  const [password, setPassword] = useState('')
  const passwordRef = useRef<HTMLInputElement>(null)

  // The password field takes focus on open, as REV-03.4 requires.
  useEffect(() => {
    if (open && !blocked) passwordRef.current?.focus()
  }, [open, blocked])
  // Keep the selection inside what the server currently accepts.
  useEffect(() => {
    if (!meanings.includes(meaning) && meanings[0]) setMeaning(meanings[0])
  }, [meaning, meanings])

  const reset = () => {
    setConfirmation('')
    setPassword('')
    setMeaning(initialMeaning ?? fallbackMeaning)
  }
  const confirmationMatches =
    confirmation.trim().toLowerCase() === signingAs.trim().toLowerCase()
  const digestMissing = subject !== undefined && !subject.digest
  const canSubmit =
    !busy &&
    !blocked &&
    Boolean(password) &&
    (!requireConfirmation || confirmationMatches) &&
    !digestMissing
  const selected =
    SIGNATURE_MEANING_OPTIONS.find((option) => option.value === meaning) ??
    SIGNATURE_MEANING_OPTIONS[0]

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent
        initialFocus={passwordRef}
        className="w-[min(560px,calc(100vw-32px))]"
      >
        <DialogHeader title={title} description={description} />
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canSubmit) return
            const enteredPassword = password
            // Do not retain the secret once the step-up has been handed it.
            setPassword('')
            onSubmit({ meaning, confirmation, password: enteredPassword })
          }}
        >
          <DialogBody>
            {blocked ? (
              blocked
            ) : (
              <>
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label">
                  <dt className="text-fg-muted">
                    {t('notebook.eSignDialog.signingAs')}
                  </dt>
                  <dd className="m-0">{signingAs}</dd>
                  <dt className="text-fg-muted">
                    {t('notebook.eSignDialog.meaning')}
                  </dt>
                  <dd className="m-0 font-medium">{selected.label}</dd>
                  {subject?.revisionId ? (
                    <>
                      <dt className="text-fg-muted">
                        {t('notebook.eSignDialog.revision')}
                      </dt>
                      <dd className="m-0 font-mono break-all">
                        {subject.revisionId}
                      </dd>
                    </>
                  ) : null}
                  {subject ? (
                    <>
                      <dt className="text-fg-muted">
                        {t('notebook.eSignDialog.contentHash')}
                      </dt>
                      <dd className="m-0 font-mono break-all">
                        {subject.digest ??
                          t('notebook.eSignDialog.unavailable')}
                      </dd>
                    </>
                  ) : null}
                  <dt className="text-fg-muted">
                    {t('notebook.eSignDialog.time')}
                  </dt>
                  <dd className="m-0">
                    {t('notebook.eSignDialog.recordedAsTheTime')}
                  </dd>
                </dl>
                <Field
                  label={t('notebook.eSignDialog.label')}
                  hint={t('notebook.eSignDialog.hint')}
                >
                  <Input
                    ref={passwordRef}
                    aria-label={t('notebook.eSignDialog.label')}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
                {meanings.length > 0 ? (
                  <Field
                    label={t('notebook.eSignDialog.signatureMeaningLabel')}
                  >
                    <Select
                      aria-label={t(
                        'notebook.eSignDialog.signatureMeaningLabel',
                      )}
                      value={meaning}
                      onChange={(event) =>
                        setMeaning(
                          event.target.value as PostSubmissionSignatureMeaning,
                        )
                      }
                    >
                      {SIGNATURE_MEANING_OPTIONS.filter((option) =>
                        meanings.includes(option.value),
                      ).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                <p className="m-0 text-label text-fg-muted">
                  {selected.description}
                </p>
                <p className="m-0 rounded-md border border-border bg-surface-muted px-2 py-1.5 text-label text-fg-muted">
                  {ASSURANCE_LEVEL_STATEMENT.standard}
                </p>
                {requireConfirmation ? (
                  <Field label={t('notebook.eSignDialog.typeYourNameToLabel')}>
                    <Input
                      aria-label={t('notebook.eSignDialog.typeYourNameToLabel')}
                      type="text"
                      placeholder={signingAs}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                ) : null}
              </>
            )}
            {errorMessage ? <Notice tone="bad">{errorMessage}</Notice> : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>
              {blocked ? t('common.actions.close') : cancelLabel}
            </DialogClose>
            {!blocked ? (
              <Button variant="primary" type="submit" disabled={!canSubmit}>
                {busy ? t('notebook.eSignDialog.signing') : submitLabel}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
