import { DescriptionList, Muted, Section } from '#/components/ui/layout'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { RequestQualificationButton } from '#/components/instruments/request-qualification-button'
import { t } from '#/copy'

import type { QualificationRow } from './-instrument-columns'

/**
 * Who may run this instrument: the qualification table, the people waiting to
 * be qualified, and the grant or request action for the reader.
 */
export function QualificationSection({
  instrumentId,
  instrumentName,
  qualificationsStatus,
  qualifierError,
  rows,
  columns,
  scope,
  canQualify,
  canRecord,
  iAmQualified,
  iHaveAsked,
  requestRows,
  userLabel,
  dismissPending,
  onDismiss,
  onQualify,
  onGrant,
  onRequested,
}: {
  instrumentId: string
  instrumentName: string
  qualificationsStatus: 'pending' | 'error' | 'success'
  qualifierError: unknown
  rows: QualificationRow[]
  columns: RegistryColumn<QualificationRow>[]
  scope: string | null
  canQualify: boolean
  canRecord: boolean
  iAmQualified: boolean
  iHaveAsked: boolean
  requestRows: { id: string; user_id: string; note: string | null }[]
  userLabel: (userId: string) => string
  dismissPending: boolean
  onDismiss: (requestId: string) => void
  onQualify: (userId: string) => void
  onGrant: () => void
  onRequested: () => void
}) {
  return (
    <Section
      className="border-t border-border pt-4"
      title={t('library.instruments.record.qualification')}
      count={qualificationsStatus === 'success' ? rows.length : undefined}
    >
      {qualificationsStatus === 'pending' ? (
        <Muted>{t('library.instruments.record.loadingQualifications')}</Muted>
      ) : qualificationsStatus === 'error' ? (
        <Notice
          tone="bad"
          title={t('library.instruments.record.theQualificationsCouldNotBe')}
        >
          {qualifierError instanceof Error
            ? qualifierError.message
            : t('library.instruments.record.theDatabaseRefusedTheRequest')}
        </Notice>
      ) : rows.length ? (
        <>
          <DescriptionList
            labelWidth={130}
            items={[
              [
                t('library.instruments.record.qualifiedFor'),
                scope ?? t('library.instruments.record.notSet'),
              ],
            ]}
          />
          <TableBox>
            <RegistryGrid
              label={t('library.instruments.record.qualifiedOperators')}
              rows={rows}
              columns={columns}
              getRowId={(row) => row.user_id}
              selectable={false}
            />
          </TableBox>
        </>
      ) : (
        <Muted>
          {t('library.instruments.record.noOneIsQualifiedTo', {
            name: instrumentName,
          })}
        </Muted>
      )}
      <QualificationRequests
        requests={requestRows}
        userLabel={userLabel}
        canQualify={canQualify}
        dismissPending={dismissPending}
        onDismiss={onDismiss}
        onQualify={onQualify}
      />
      <QualificationActions
        instrumentId={instrumentId}
        instrumentName={instrumentName}
        canQualify={canQualify}
        canRecord={canRecord}
        iAmQualified={iAmQualified}
        iHaveAsked={iHaveAsked}
        onGrant={onGrant}
        onRequested={onRequested}
      />
    </Section>
  )
}

/** The people who have asked to be qualified, and the two answers to each. */
function QualificationRequests({
  requests,
  userLabel,
  canQualify,
  dismissPending,
  onDismiss,
  onQualify,
}: {
  requests: { id: string; user_id: string; note: string | null }[]
  userLabel: (userId: string) => string
  canQualify: boolean
  dismissPending: boolean
  onDismiss: (requestId: string) => void
  onQualify: (userId: string) => void
}) {
  if (!canQualify || !requests.length) return null

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <h3 className="m-0 text-label font-medium text-fg">
        {t('library.instruments.record.waitingToBeQualified')}
      </h3>
      {requests.map((request) => (
        <div
          key={request.id}
          className="flex flex-wrap items-center gap-2 text-body"
        >
          <span className="font-medium text-fg">
            {userLabel(request.user_id)}
          </span>
          {request.note ? (
            <span className="text-fg-muted">{request.note}</span>
          ) : null}
          <span className="ml-auto flex gap-1.5">
            <Button
              size="sm"
              variant="primary"
              onClick={() => onQualify(request.user_id)}
            >
              {t('library.instruments.record.qualify')}
            </Button>
            <Button
              size="sm"
              disabled={dismissPending}
              onClick={() => onDismiss(request.id)}
            >
              {t('common.actions.dismiss')}
            </Button>
          </span>
        </div>
      ))}
    </div>
  )
}

/** Grant, for an owner; ask, for anyone else who may run the instrument. */
function QualificationActions({
  instrumentId,
  instrumentName,
  canQualify,
  canRecord,
  iAmQualified,
  iHaveAsked,
  onGrant,
  onRequested,
}: {
  instrumentId: string
  instrumentName: string
  canQualify: boolean
  canRecord: boolean
  iAmQualified: boolean
  iHaveAsked: boolean
  onGrant: () => void
  onRequested: () => void
}) {
  if (canQualify) {
    return (
      <div className="mt-1.5">
        <Button size="sm" icon="plus" onClick={onGrant}>
          {t('library.instruments.record.grantQualification')}
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      <Muted>{t('library.instruments.record.aWorkspaceOwnerGrantsAnd')}</Muted>
      {iAmQualified || !canRecord ? null : (
        <div>
          <RequestQualificationButton
            instrumentId={instrumentId}
            instrumentName={instrumentName}
            alreadyRequested={iHaveAsked}
            onRequested={onRequested}
          />
        </div>
      )}
    </div>
  )
}
