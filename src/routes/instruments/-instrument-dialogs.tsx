import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import { Muted } from '#/components/ui/layout'
import { Notice } from '#/components/ui/alert'
import { Select } from '#/components/ui/select'
import { FileDrop } from '#/components/ui/file-drop'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import { projectOption } from '#/components/record-picker/entity-options'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
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
import { Textarea } from '#/components/inventory/list'
import { formatInstrumentDay } from '#/components/instruments/instruments-data'
import { uploadProjectFile } from '#/lib/file-attach'
import {
  BackInServiceDialog,
  MarkOutOfServiceDialog,
} from '#/components/instruments/out-of-service'
import type { InstrumentRow } from '#/components/instruments/instruments-data'
import { isoDay } from './-instrument-day'
import { t } from '#/copy'

import type { QualificationRow } from './-instrument-columns'

/** A recorded calibration, with its optional GxP certificate. */
export function RecordCalibrationDialog({
  open,
  onOpenChange,
  performed,
  onPerformed,
  due,
  onDue,
  certificateProjectId,
  projectOptions,
  onCertificateProject,
  certificate,
  onCertificate,
  notes,
  onNotes,
  pending,
  onRecord,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  performed: string
  onPerformed: (value: string) => void
  due: string
  onDue: (value: string) => void
  certificateProjectId: string
  projectOptions: { id: string; title: string }[]
  onCertificateProject: (id: string) => void
  certificate: { fileObjectId: string; displayName: string } | null
  onCertificate: (
    value: {
      fileObjectId: string
      displayName: string
    } | null,
  ) => void
  notes: string
  onNotes: (value: string) => void
  pending: boolean
  onRecord: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.instruments.record.recordCalibration')}
        />
        <DialogBody>
          <div className="flex flex-col gap-3">
            <Field label={t('library.instruments.record.performed')} required>
              <Input
                type="date"
                value={performed}
                onChange={(e) => onPerformed(e.target.value)}
              />
            </Field>
            <Field label={t('library.instruments.record.nextDue')} required>
              <Input
                type="date"
                value={due}
                onChange={(e) => onDue(e.target.value)}
              />
            </Field>
            <Field
              label={t('library.instruments.record.certificateProject')}
              hint={t('library.instruments.record.theCertificateIsKeptAs')}
            >
              <PickerSelect
                noun="project"
                value={certificateProjectId}
                onChange={onCertificateProject}
                disabled={projectOptions.length === 0}
                placeholder={
                  projectOptions.length === 0
                    ? 'No projects available'
                    : undefined
                }
                options={projectOptions.map((project) =>
                  projectOption(project),
                )}
              />
            </Field>
            {certificate ? (
              <div className="flex items-center justify-between gap-2 text-label">
                <span>
                  {t('library.instruments.record.certificate', {
                    displayName: certificate.displayName,
                  })}
                </span>
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => onCertificate(null)}
                >
                  {t('common.actions.remove')}
                </Button>
              </div>
            ) : projectOptions.length ? (
              <FileDrop
                label={t(
                  'library.instruments.record.attachTheCalibrationCertificate',
                )}
                inputLabel="Calibration certificate"
                hint={t('library.instruments.record.optionalButGxpUseNeeds')}
                onFile={async (file) => {
                  if (!file) return
                  onCertificate(
                    await uploadProjectFile({
                      projectId: certificateProjectId,
                      file,
                    }),
                  )
                }}
              />
            ) : (
              <Muted>
                {t('library.instruments.record.certificatesAreStoredInA')}
              </Muted>
            )}
            <Field
              label={t('library.instruments.record.notes')}
              hint={t('library.instruments.record.optional')}
            >
              <Textarea
                value={notes}
                onChange={(e) => onNotes(e.target.value)}
              />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!performed || !due || pending}
            onClick={onRecord}
          >
            {pending
              ? t('library.instruments.record.recording')
              : t('library.instruments.record.recordCalibration')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Who may run the instrument, for how long and for what scope. */
export function GrantQualificationDialog({
  open,
  onOpenChange,
  instrumentName,
  members,
  membersError,
  userLabel,
  grantUser,
  onUser,
  grantUntil,
  onUntil,
  minUntil,
  today,
  grantScope,
  onScope,
  scope,
  pending,
  onGrant,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  instrumentName: string
  members: { user_id: string }[]
  membersError: unknown
  userLabel: (userId: string) => string
  grantUser: string
  onUser: (value: string) => void
  grantUntil: string
  onUntil: (value: string) => void
  /** The earliest date the picker offers. */
  minUntil: string
  /** Today, so a date that has passed cannot be granted. */
  today: string
  grantScope: string
  onScope: (value: string) => void
  scope: string | null
  pending: boolean
  onGrant: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.instruments.record.grantQualification')}
          description={t('library.instruments.record.whoMayRunAndUntil', {
            name: instrumentName,
          })}
        />
        <DialogBody>
          <div className="flex flex-col gap-3">
            <Field label={t('library.instruments.record.person')} required>
              <Select
                value={grantUser}
                onChange={(e) => onUser(e.target.value)}
              >
                <option value="">
                  {t('library.instruments.record.chooseAWorkspaceMember')}
                </option>
                {members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {userLabel(member.user_id)}
                  </option>
                ))}
              </Select>
            </Field>
            {membersError ? (
              <Notice
                tone="bad"
                title={t('library.instruments.record.theMemberListCouldNot')}
              >
                {membersError instanceof Error
                  ? membersError.message
                  : t(
                      'library.instruments.record.theDatabaseRefusedTheRequest',
                    )}
              </Notice>
            ) : null}
            <Field
              label={t('library.instruments.record.validUntil')}
              required
              hint={t('library.instruments.record.bookingIsRefusedFromThis')}
            >
              <Input
                type="date"
                min={minUntil}
                value={grantUntil}
                onChange={(e) => onUntil(e.target.value)}
              />
            </Field>
            <Field
              label={t('library.instruments.record.qualifiedFor')}
              hint={
                scope
                  ? t('library.instruments.record.theInstrumentsScopeIsLeave', {
                      scope,
                    })
                  : t('library.instruments.record.optionalScopeOnTheInstrument')
              }
            >
              <Input
                value={grantScope}
                onChange={(e) => onScope(e.target.value)}
              />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={
              !grantUser || !grantUntil || grantUntil <= today || pending
            }
            onClick={onGrant}
          >
            {pending
              ? t('library.instruments.record.granting')
              : t('library.instruments.record.grantQualification')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The revoke confirmation, naming the person and what they lose. */
export function RevokeQualificationDialog({
  target,
  onOpenChange,
  instrumentName,
  personLabel,
  pending,
  onRevoke,
}: {
  target: QualificationRow | null
  onOpenChange: (open: boolean) => void
  instrumentName: string
  personLabel: (row: QualificationRow) => string
  pending: boolean
  onRevoke: () => void
}) {
  return (
    <ConfirmDialog open={target !== null} onOpenChange={onOpenChange}>
      <ConfirmDialogContent className="w-[min(480px,calc(100vw-32px))]">
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {t('library.instruments.record.revokeTheQualification')}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {target ? personLabel(target) : ''}{' '}
            {t('library.instruments.record.until', {
              valid_until: formatInstrumentDay(target?.valid_until),
            })}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <DialogBody>
          <p className="m-0 text-body leading-5">
            {t(
              'library.instruments.record.bookingRequiresACurrentQualification',
              { name: instrumentName },
            )}
          </p>
        </DialogBody>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={pending} />
          <ConfirmDialogAction
            variant="danger-fill"
            disabled={pending}
            onClick={onRevoke}
          >
            {t('library.instruments.record.revokeQualification')}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}

/** The instrument page's dialogs: calibration, grant, revoke and service state. */
export function InstrumentDialogs({
  instrument,
  page,
  mutations,
  projectOptions,
  members,
  membersError,
  userLabel,
  scope,
}: {
  instrument: InstrumentRow
  page: {
    recordOpen: boolean
    setRecordOpen: (open: boolean) => void
    downOpen: boolean
    setDownOpen: (open: boolean) => void
    upOpen: boolean
    setUpOpen: (open: boolean) => void
    performed: string
    setPerformed: (value: string) => void
    due: string
    setDue: (value: string) => void
    notes: string
    setNotes: (value: string) => void
    certificate: { fileObjectId: string; displayName: string } | null
    setCertificate: (
      value: { fileObjectId: string; displayName: string } | null,
    ) => void
    certificateProject: string
    setCertificateProject: (value: string) => void
    grantOpen: boolean
    setGrantOpen: (open: boolean) => void
    grantUser: string
    setGrantUser: (value: string) => void
    grantUntil: string
    setGrantUntil: (value: string) => void
    grantScope: string
    setGrantScope: (value: string) => void
    revokeTarget: QualificationRow | null
    setRevokeTarget: (row: QualificationRow | null) => void
  }
  mutations: {
    record: {
      isPending: boolean
      mutate: (input: {
        performedAt: string
        dueAt: string
        certificateFileId: string | null
        notes: string | null
      }) => void
    }
    grant: {
      isPending: boolean
      mutate: (input: {
        userId: string
        validUntil: string
        qualifiedFor: string | null
      }) => void
    }
    revoke: { isPending: boolean; mutate: (userId: string) => void }
  }
  projectOptions: { id: string; title: string }[]
  members: { user_id: string }[]
  membersError: unknown
  userLabel: (userId: string) => string
  scope: string | null
}) {
  const certificateProjectId =
    page.certificateProject || projectOptions[0]?.id || ''

  return (
    <>
      <MarkOutOfServiceDialog
        instrument={instrument}
        open={page.downOpen}
        onOpenChange={page.setDownOpen}
      />
      <BackInServiceDialog
        instrument={instrument}
        open={page.upOpen}
        onOpenChange={page.setUpOpen}
      />

      <RecordCalibrationDialog
        open={page.recordOpen}
        onOpenChange={page.setRecordOpen}
        performed={page.performed}
        onPerformed={page.setPerformed}
        due={page.due}
        onDue={page.setDue}
        certificateProjectId={certificateProjectId}
        projectOptions={projectOptions}
        onCertificateProject={page.setCertificateProject}
        certificate={page.certificate}
        onCertificate={page.setCertificate}
        notes={page.notes}
        onNotes={page.setNotes}
        pending={mutations.record.isPending}
        onRecord={() =>
          mutations.record.mutate({
            performedAt: `${page.performed}T00:00:00.000Z`,
            dueAt: `${page.due}T00:00:00.000Z`,
            certificateFileId: page.certificate?.fileObjectId ?? null,
            notes: page.notes.trim() || null,
          })
        }
      />

      <GrantQualificationDialog
        open={page.grantOpen}
        onOpenChange={page.setGrantOpen}
        instrumentName={instrument.name}
        members={members}
        membersError={membersError}
        userLabel={userLabel}
        grantUser={page.grantUser}
        onUser={page.setGrantUser}
        grantUntil={page.grantUntil}
        onUntil={page.setGrantUntil}
        minUntil={isoDay(1)}
        today={isoDay()}
        grantScope={page.grantScope}
        onScope={page.setGrantScope}
        scope={scope}
        pending={mutations.grant.isPending}
        onGrant={() =>
          mutations.grant.mutate({
            userId: page.grantUser,
            validUntil: `${page.grantUntil}T00:00:00.000Z`,
            qualifiedFor: page.grantScope.trim() || null,
          })
        }
      />

      <RevokeQualificationDialog
        target={page.revokeTarget}
        onOpenChange={(open) => {
          if (!open) page.setRevokeTarget(null)
        }}
        instrumentName={instrument.name}
        personLabel={(row) => row.user_name ?? userLabel(row.user_id)}
        pending={mutations.revoke.isPending}
        onRevoke={() => {
          if (page.revokeTarget)
            mutations.revoke.mutate(page.revokeTarget.user_id)
        }}
      />
    </>
  )
}
