import { SearchableSelect } from '#/components/record-picker/searchable-select'
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Textarea } from '#/components/inventory/list'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { toast } from '#/components/ui/sonner'
import { useDemoSigning } from '#/lib/demo-signing'
import { partQueryKeys } from '#/lib/experiment-parts'
import type { PartProgress } from '#/lib/experiment-parts'
import { notebookDataClient, notebookQueryKeys } from '#/lib/notebook-data'
import {
  amendExperimentPart,
  fetchPartSignoffRequests,
  fetchPartSignoffs,
  partSignoffQueryKeys,
  previewPartSignoff,
  requestPartSignoff,
  signExperimentPart,
} from '#/lib/part-signoff'
import type { PartSignoffStatus } from '#/lib/part-signoff'
import { useUserNames } from '#/lib/user-names'
import { adminQueryKeys, fetchWorkspaceMembers } from '#/lib/workspace-admin'
import { useDisplayTimeZone } from '#/lib/display-time-zone'
import { dateTimeFormat } from '#/lib/intl-cache'

function useSignatureDateTime() {
  const timeZone = useDisplayTimeZone()

  return dateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  })
}

/** Where each part stands on signatures; empty until loaded or when none needs one. */
export function usePartSignoffs(recordId: string, enabled = true) {
  const query = useQuery({
    queryKey: partSignoffQueryKeys.forRecord(recordId),
    queryFn: () => fetchPartSignoffs(notebookDataClient, recordId),
    enabled,
  })

  return query.data ?? EMPTY
}

const EMPTY: PartSignoffStatus[] = []

/** The requests to sign or countersign that are waiting on this person. */
export function usePartRequests(recordId: string, userId?: string) {
  const query = useQuery({
    queryKey: [...partSignoffQueryKeys.requests(recordId), userId ?? 'none'],
    queryFn: () =>
      fetchPartSignoffRequests(notebookDataClient, recordId, userId!),
    enabled: Boolean(userId),
  })

  return query.data ?? []
}

/** Refresh everything a sign-off, countersign or amendment touches. */
function useRefreshSignoffs(recordId: string) {
  const queryClient = useQueryClient()

  return React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: partSignoffQueryKeys.forRecord(recordId),
      }),
      queryClient.invalidateQueries({
        queryKey: partQueryKeys.forRecord(recordId),
      }),
      queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.blocks(recordId),
      }),
      queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.record(recordId),
      }),
    ])
  }, [queryClient, recordId])
}

function errorText(error: Error | null): string {
  return error instanceof Error && error.message
    ? error.message
    : t('notebook.partSignoff.couldNotSign')
}

/** The workspace's people, for naming who to ask. */
function usePeople(workspaceId: string | undefined, exceptUserId?: string) {
  const members = useQuery({
    queryKey: adminQueryKeys.members(workspaceId ?? 'none'),
    queryFn: () => fetchWorkspaceMembers(notebookDataClient, workspaceId!),
    enabled: Boolean(workspaceId),
  })

  const people = (members.data ?? []).filter(
    (member) => member.suspendedAt === null && member.userId !== exceptUserId,
  )

  const { userLabel } = useUserNames(people.map((member) => member.userId))

  return { people, userLabel }
}

/**
 * Sign a part, or countersign a signed one. The password check is the one used
 * for every signature (a fresh password, or the typed name in the demo); it is
 * tied to this part and to the digest shown here, so a part that changed since
 * it was opened cannot be signed by accident.
 */
export function PartSignDialog({
  workspaceId,
  recordId,
  part,
  meaning,
  signingAs,
  currentUserId,
  onClose,
}: {
  workspaceId?: string
  recordId: string
  part: PartProgress
  meaning: 'signed' | 'witnessed'
  signingAs: string
  currentUserId?: string
  onClose: () => void
}) {
  const demo = useDemoSigning()
  const refresh = useRefreshSignoffs(recordId)
  const [password, setPassword] = React.useState('')
  const [confirmation, setConfirmation] = React.useState('')
  const [countersigner, setCountersigner] = React.useState('')

  const preview = useQuery({
    queryKey: partSignoffQueryKeys.preview(part.id),
    queryFn: () => previewPartSignoff(notebookDataClient, part.id),
    staleTime: 0,
    gcTime: 0,
  })

  const { people, userLabel } = usePeople(workspaceId, currentUserId)
  const signing = meaning === 'signed'

  const sign = useMutation({
    mutationFn: () => {
      if (!workspaceId || !preview.data) throw new Error('not ready')

      return signExperimentPart(notebookDataClient, {
        workspaceId,
        partId: part.id,
        meaning,
        digest: preview.data.digest,
        confirmation,
        password: demo ? 'demo-signature' : password,
        countersignUserIds: signing && countersigner ? [countersigner] : [],
      })
    },
    onSuccess: async () => {
      await refresh()
      toast.success(
        t(
          signing
            ? 'notebook.partSignoff.signedToast'
            : 'notebook.partSignoff.countersignedToast',
          { number: String(part.number) },
        ),
      )
      onClose()
    },
    onSettled: () => setPassword(''),
  })

  const nameMatches =
    confirmation.trim().toLowerCase() === signingAs.trim().toLowerCase()

  const ready =
    Boolean(preview.data) &&
    nameMatches &&
    (demo || password !== '') &&
    !sign.isPending

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t(
            signing
              ? 'notebook.partSignoff.signTitle'
              : 'notebook.partSignoff.countersignTitle',
            { number: String(part.number), title: part.title },
          )}
          description={t(
            signing
              ? 'notebook.partSignoff.signDescription'
              : 'notebook.partSignoff.countersignDescription',
          )}
        />
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()

            if (ready) sign.mutate()
          }}
        >
          <DialogBody>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label">
              <dt className="text-fg-muted">
                {t('notebook.eSignDialog.signingAs')}
              </dt>
              <dd className="m-0">{signingAs}</dd>
              <dt className="text-fg-muted">
                {t('notebook.partSignoff.covers')}
              </dt>
              <dd className="m-0" data-testid="part-signoff-covers">
                {preview.data
                  ? t('notebook.partSignoff.coversValue', {
                      blocks: preview.data.blockCount,
                      steps: preview.data.stepCount,
                    })
                  : t('common.states.loading')}
              </dd>
              <dt className="text-fg-muted">
                {t('notebook.eSignDialog.time')}
              </dt>
              <dd className="m-0">
                {t('notebook.eSignDialog.recordedAsTheTime')}
              </dd>
            </dl>
            {demo ? (
              <Notice tone="info" title={t('notebook.eSignDialog.demoTitle')}>
                {t('notebook.eSignDialog.demoNotice')}
              </Notice>
            ) : (
              <Field
                label={t('notebook.eSignDialog.label')}
                hint={t('notebook.eSignDialog.hint')}
              >
                <Input
                  autoFocus
                  aria-label={t('notebook.eSignDialog.label')}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
            )}
            <Field label={t('notebook.eSignDialog.typeYourNameToLabel')}>
              <Input
                aria-label={t('notebook.eSignDialog.typeYourNameToLabel')}
                type="text"
                placeholder={signingAs}
                value={confirmation}
                autoComplete="off"
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </Field>
            {signing && people.length > 0 ? (
              <Field
                label={t('notebook.partSignoff.countersignLabel')}
                hint={t('notebook.partSignoff.countersignHint')}
              >
                <SearchableSelect
                  noun="member"
                  value={countersigner}
                  onValueChange={(value) => setCountersigner(value)}
                >
                  <option value="">
                    {t('notebook.partSignoff.countersignNobody')}
                  </option>
                  {people.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {userLabel(member.userId)}
                    </option>
                  ))}
                </SearchableSelect>
              </Field>
            ) : null}
            {sign.isError ? (
              <Notice tone="bad">{errorText(sign.error)}</Notice>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={!ready}>
              {sign.isPending
                ? t('notebook.eSignDialog.signing')
                : t(
                    signing
                      ? 'notebook.partSignoff.signButton'
                      : 'notebook.partSignoff.countersignButton',
                    { number: String(part.number) },
                  )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Ask a person to sign a finished part, or to countersign a signed one. */
export function AskToSignDialog({
  workspaceId,
  recordId,
  part,
  kind,
  currentUserId,
  onClose,
}: {
  workspaceId?: string
  recordId: string
  part: PartProgress
  kind: 'sign' | 'countersign'
  currentUserId?: string
  onClose: () => void
}) {
  const refresh = useRefreshSignoffs(recordId)
  const { people, userLabel } = usePeople(workspaceId, currentUserId)
  const [person, setPerson] = React.useState('')
  const [note, setNote] = React.useState('')

  const send = useMutation({
    mutationFn: () =>
      requestPartSignoff(notebookDataClient, {
        partId: part.id,
        userId: person,
        note,
      }),
    onSuccess: async () => {
      await refresh()
      toast.success(
        t('notebook.partSignoff.askedToast', { name: userLabel(person) }),
      )
      onClose()
    },
  })

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={t(
            kind === 'sign'
              ? 'notebook.partSignoff.askSignTitle'
              : 'notebook.partSignoff.askCountersignTitle',
            { number: String(part.number) },
          )}
          description={t('notebook.partSignoff.askHint')}
        />
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()

            if (person && !send.isPending) send.mutate()
          }}
        >
          <DialogBody>
            <Field label={t('notebook.partSignoff.askWho')} required>
              <SearchableSelect
                noun="member"
                value={person}
                onValueChange={(value) => setPerson(value)}
              >
                <option value="">{t('notebook.partSignoff.askChoose')}</option>
                {people.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {userLabel(member.userId)}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            <Field label={t('notebook.partSignoff.askNote')}>
              <Input
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            {send.isError ? (
              <Notice tone="bad">{errorText(send.error)}</Notice>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!person || send.isPending}
            >
              {t('notebook.partSignoff.askSend')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Amend a signed part: it needs a reason, reopens only that part and is kept in the history. */
export function AmendPartDialog({
  recordId,
  part,
  onClose,
}: {
  recordId: string
  part: PartProgress
  onClose: () => void
}) {
  const refresh = useRefreshSignoffs(recordId)
  const [reason, setReason] = React.useState('')

  // useRefreshSignoffs owns signoff, part, block and record invalidation.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  const amend = useMutation({
    mutationFn: () =>
      amendExperimentPart(notebookDataClient, part.id, reason.trim()),
    onSuccess: async () => {
      await refresh()
      toast.success(
        t('notebook.partSignoff.amendedToast', { number: String(part.number) }),
      )
      onClose()
    },
  })

  const ready = reason.trim().length >= 3 && !amend.isPending

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={t('notebook.partSignoff.amendTitle', {
            number: String(part.number),
          })}
          description={t('notebook.partSignoff.amendDescription')}
        />
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()

            if (ready) amend.mutate()
          }}
        >
          <DialogBody>
            <Field
              label={t('notebook.partSignoff.amendReason')}
              hint={t('notebook.partSignoff.amendReasonHint')}
              required
            >
              <Textarea
                autoFocus
                value={reason}
                maxLength={2000}
                aria-label={t('notebook.partSignoff.amendReason')}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            {amend.isError ? (
              <Notice tone="bad">{errorText(amend.error)}</Notice>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={!ready}>
              {t('notebook.partSignoff.amendButton', {
                number: String(part.number),
              })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type Dialogs = 'sign' | 'witness' | 'ask-sign' | 'ask-countersign' | 'amend'

/**
 * The Now card when a part's work is done and it waits for its signature:
 * "Sign off Part 2 to open Part 3". Signing is the person's own act, so the
 * other choice is to ask someone else to do it.
 */
export function SignOffPartCard({
  recordId,
  workspaceId,
  part,
  next,
  status,
  canEdit,
  currentUserId,
  currentUserName,
  submit,
}: {
  recordId: string
  workspaceId?: string
  part: PartProgress
  next: PartProgress | null
  status: PartSignoffStatus | undefined
  canEdit: boolean
  currentUserId?: string
  currentUserName?: string
  submit?: React.ReactNode
}) {
  const [dialog, setDialog] = React.useState<Dialogs | null>(null)
  const asked = status?.signRequestedFrom ?? []
  const { userLabel } = useUserNames(asked)

  const reopened =
    status && status.amendmentCount > 0 && status.lastAmendmentReason

  return (
    <>
      <div className="flex flex-col gap-1" data-testid="sign-off-card">
        <p className="m-0 text-label font-semibold uppercase tracking-[0.06em] text-fg-muted">
          {t('notebook.partSignoff.eyebrow', { number: String(part.number) })}
        </p>
        <h2 className="m-0 font-heading text-doc font-semibold leading-snug text-fg">
          {next
            ? t('notebook.partSignoff.cardTitle', {
                number: String(part.number),
                next: String(next.number),
              })
            : t('notebook.partSignoff.cardTitleLast', {
                number: String(part.number),
              })}
        </h2>
        <p className="m-0 text-body text-fg-muted">
          {reopened
            ? t('notebook.partSignoff.cardReopened', {
                reason: status.lastAmendmentReason!,
              })
            : t('notebook.partSignoff.cardBody')}
          {asked.length > 0
            ? ` ${t('notebook.partSignoff.waitingForSign', {
                names: asked.map(userLabel).join(', '),
              })}`
            : ''}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 max-md:[&>button]:flex-1">
        {canEdit && currentUserName ? (
          <>
            <Button
              variant="primary"
              icon="lock"
              data-testid="sign-off-part"
              onClick={() => setDialog('sign')}
            >
              {t('notebook.partSignoff.signOff', {
                number: String(part.number),
              })}
            </Button>
            <Button onClick={() => setDialog('ask-sign')}>
              {t('notebook.partSignoff.askToSign')}
            </Button>
          </>
        ) : null}
        {submit ? (
          <span className="ml-auto max-md:w-full">{submit}</span>
        ) : null}
      </div>
      {dialog === 'sign' && currentUserName ? (
        <PartSignDialog
          workspaceId={workspaceId}
          recordId={recordId}
          part={part}
          meaning="signed"
          signingAs={currentUserName}
          currentUserId={currentUserId}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'ask-sign' ? (
        <AskToSignDialog
          workspaceId={workspaceId}
          recordId={recordId}
          part={part}
          kind="sign"
          currentUserId={currentUserId}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  )
}

/**
 * On a signed part: who signed it and when, that it is locked, who has
 * countersigned or been asked to, and the way to amend it (or to countersign
 * it when asked).
 */
export function SignedPartBanner({
  recordId,
  workspaceId,
  part,
  status,
  canEdit,
  currentUserId,
  currentUserName,
  hasCountersignRequest,
}: {
  recordId: string
  workspaceId?: string
  part: PartProgress
  status: PartSignoffStatus
  canEdit: boolean
  currentUserId?: string
  currentUserName?: string
  hasCountersignRequest: boolean
}) {
  const [dialog, setDialog] = React.useState<Dialogs | null>(null)
  const dateTime = useSignatureDateTime()

  const { userLabel } = useUserNames([
    ...status.countersignedBy,
    ...status.countersignRequestedFrom,
  ])

  const signer = status.signerName ?? ''
  const when = status.signedAt ? dateTime.format(new Date(status.signedAt)) : ''

  return (
    <section
      role="status"
      data-testid="part-signed-banner"
      className="my-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon
          name="lock"
          size={16}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-success-text"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="m-0 text-body font-semibold text-fg">
            {t('notebook.partSignoff.bannerTitle', {
              name: signer,
              when,
            })}
          </p>
          <p className="m-0 text-label text-fg-muted">
            {t('notebook.partSignoff.bannerBody')}
            {status.countersignedBy.length > 0
              ? ` ${t('notebook.partSignoff.countersignedBy', {
                  names: status.countersignedBy.map(userLabel).join(', '),
                })}`
              : ''}
            {status.countersignRequestedFrom.length > 0
              ? ` ${t('notebook.partSignoff.waitingForCountersign', {
                  names: status.countersignRequestedFrom
                    .map(userLabel)
                    .join(', '),
                })}`
              : ''}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 max-md:w-full max-md:[&>button]:flex-1">
        {hasCountersignRequest && currentUserName ? (
          <Button
            variant="primary"
            data-testid="countersign-part"
            onClick={() => setDialog('witness')}
          >
            {t('notebook.partSignoff.countersignButton', {
              number: String(part.number),
            })}
          </Button>
        ) : null}
        {canEdit ? (
          <>
            <Button onClick={() => setDialog('ask-countersign')}>
              {t('notebook.partSignoff.askToCountersign')}
            </Button>
            <Button data-testid="amend-part" onClick={() => setDialog('amend')}>
              {t('notebook.partSignoff.amendOpen', {
                number: String(part.number),
              })}
            </Button>
          </>
        ) : null}
      </div>
      {dialog === 'witness' && currentUserName ? (
        <PartSignDialog
          workspaceId={workspaceId}
          recordId={recordId}
          part={part}
          meaning="witnessed"
          signingAs={currentUserName}
          currentUserId={currentUserId}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'ask-countersign' ? (
        <AskToSignDialog
          workspaceId={workspaceId}
          recordId={recordId}
          part={part}
          kind="countersign"
          currentUserId={currentUserId}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'amend' ? (
        <AmendPartDialog
          recordId={recordId}
          part={part}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  )
}

/**
 * The part sign-offs of an experiment, for the final review: who signed each
 * part, who countersigned it and whether it was reopened. Nothing shows when
 * no part needs a signature.
 */
export function PartSignoffReviewSection({ recordId }: { recordId: string }) {
  const statuses = usePartSignoffs(recordId)
  const dateTime = useSignatureDateTime()

  const rows = statuses.filter(
    (status) => status.requiresSignOff || status.signed,
  )

  const { userLabel } = useUserNames(
    rows.flatMap((row) => [
      ...(row.signedByUserId ? [row.signedByUserId] : []),
      ...row.countersignedBy,
    ]),
  )

  if (rows.length === 0) return null

  const columns: RegistryColumn<PartSignoffStatus>[] = [
    {
      id: 'part',
      header: t('notebook.partSignoff.reviewColumnPart'),
      cell: ({ row }) => `${row.original.partNumber}. ${row.original.title}`,
    },
    {
      id: 'signed',
      header: t('notebook.partSignoff.reviewColumnSigned'),
      cell: ({ row }) =>
        row.original.signed
          ? `${row.original.signerName ?? ''}${
              row.original.signedAt
                ? ` · ${dateTime.format(new Date(row.original.signedAt))}`
                : ''
            }`
          : t('notebook.partSignoff.reviewNotSigned'),
    },
    {
      id: 'countersigned',
      header: t('notebook.partSignoff.reviewColumnCountersign'),
      cell: ({ row }) =>
        row.original.countersignedBy.map((id) => userLabel(id)).join(', ') ||
        '–',
    },
    {
      id: 'amended',
      header: t('notebook.partSignoff.reviewColumnAmended'),
      meta: { cellClassName: 'num' },
      cell: ({ row }) => row.original.amendmentCount || '–',
    },
  ]

  return (
    <section data-testid="part-signoff-review">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('notebook.partSignoff.reviewTitle')}
      </h2>
      <TableBox>
        <RegistryGrid
          label={t('notebook.partSignoff.reviewTitle')}
          rows={rows}
          columns={columns}
          getRowId={(row) => row.partId}
          selectable={false}
        />
      </TableBox>
    </section>
  )
}
