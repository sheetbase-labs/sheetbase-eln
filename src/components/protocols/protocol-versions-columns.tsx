/**
 * The versions table's columns, apart from the panel that owns its dialogs and
 * mutations: what each version is, where its approval stands, and the one
 * action it needs from this person.
 */
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { rightAligned } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { canDecide, canWithdraw } from '#/components/models/model-approval'
import { chainStage, stageRoles } from '#/lib/protocol-revisions'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import type { ProtocolVersion } from '#/lib/controlled-protocols'
import { t } from '#/copy'
import type { ApprovalFor, RowDialog } from './protocol-versions'

/** What a column needs from the panel: the person, what they may do, the dialogs. */
export interface VersionsColumnContext {
  approvalFor: (version: ProtocolVersion) => ApprovalFor
  names: { userLabel: (userId: string) => string }
  userId: string | undefined
  role: string | null | undefined
  writer: boolean
  busy: boolean
  protocolRecordId: string
  onDialog: (dialog: RowDialog) => void
  onRelease: (version: ProtocolVersion) => void
}

/** How one version status is painted and named. */
interface VersionStatus {
  tone: Tone
  label: string
}

/** The status band for one version. */
function versionStatus(status: ProtocolVersion['status']): VersionStatus {
  switch (status) {
    case 'draft':
      return {
        tone: 'draft',
        label: t('library.protocols.protocolVersionsPanel.draft'),
      }
    case 'in_review':
      return {
        tone: 'review',
        label: t('library.protocols.protocolVersionsPanel.inReview'),
      }
    case 'effective':
      return {
        tone: 'ok',
        label: t('library.protocols.protocolVersionsPanel.effective'),
      }
    case 'superseded':
      return {
        tone: 'stored',
        label: t('library.protocols.protocolVersionsPanel.superseded'),
      }
    case 'retired':
      return {
        tone: 'stored',
        label: t('library.protocols.protocolVersionsPanel.retired'),
      }
  }
}

export function versionsColumns(
  context: VersionsColumnContext,
): RegistryColumn<ProtocolVersion>[] {
  const { approvalFor, names, userId, role, writer, busy } = context
  const { protocolRecordId, onDialog, onRelease } = context

  return [
    {
      id: 'version',
      header: t('library.protocols.protocolVersionsPanel.version'),
      cell: ({ row }) => <span className="num">v{row.original.version}</span>,
      meta: {
        ...rightAligned<ProtocolVersion>().meta,
        cellClassName: 'num text-right',
      },
    },
    {
      id: 'status',
      header: t('library.protocols.protocolVersionsPanel.status'),
      cell: ({ row }) => {
        const s = versionStatus(row.original.status)

        return <Status tone={s.tone}>{s.label}</Status>
      },
    },
    {
      id: 'change',
      header: t('library.protocols.protocolVersionsPanel.whatChanged'),
      cell: ({ row }) =>
        row.original.change_summary ||
        t('library.protocols.protocolVersionsPanel.noSummaryRecorded'),
    },
    {
      id: 'approval',
      header: t('library.protocols.protocolVersionsPanel.approval'),
      cell: ({ row }) => {
        const v = row.original
        const a = approvalFor(v)

        if (v.status === 'effective' || v.status === 'superseded') {
          return (
            <span className="text-fg-muted">
              {v.effective_at
                ? t('library.protocols.protocolVersionsPanel.effective2', {
                    effectiveAt: formatNotebookDateTime(v.effective_at),
                  })
                : t('library.protocols.protocolVersionsPanel.approved')}
            </span>
          )
        }

        if (v.status !== 'in_review' && v.status !== 'draft') {
          return (
            <span className="text-fg-muted">
              {t('library.protocols.protocolVersionsPanel.retired')}
            </span>
          )
        }

        if (a.pending) {
          const stage = chainStage(a.decisions, false)

          return (
            <span className="text-fg-muted">
              {stage === 'technical'
                ? t(
                    'library.protocols.protocolVersionsPanel.waitingForTechnicalReviewScientist',
                  )
                : t(
                    'library.protocols.protocolVersionsPanel.technicalReviewDoneWaitingFor',
                  )}
            </span>
          )
        }

        if (a.latest?.state === 'returned') {
          return (
            <span className="text-fg-muted">
              {t('library.protocols.protocolVersionsPanel.returned')}
              {a.latest.decision_reason ? `: ${a.latest.decision_reason}` : ''}
            </span>
          )
        }

        if (a.latest?.state === 'approved') {
          return (
            <span className="text-fg-muted">
              {t(
                'library.protocols.protocolVersionsPanel.approvedNotYetEffective',
              )}
            </span>
          )
        }

        return (
          <span className="text-fg-muted">
            {t('library.protocols.protocolVersionsPanel.notSubmitted')}
          </span>
        )
      },
    },
    {
      id: 'author',
      header: t('library.protocols.protocolVersionsPanel.author'),
      cell: ({ row }) => names.userLabel(row.original.created_by_user_id),
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'actions',
      header: () => (
        <span className="sr-only">
          {t('library.protocols.protocolVersionsPanel.actions')}
        </span>
      ),
      cell: ({ row }) => {
        const v = row.original
        const a = approvalFor(v)
        const stage = chainStage(a.decisions, false)

        const myTurn =
          a.pending !== null &&
          canDecide(a.pending, userId, role) &&
          Boolean(role && stageRoles(stage).includes(role))

        return (
          <span className="flex flex-wrap justify-end gap-1.5">
            {myTurn && a.pending ? (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => onDialog({ kind: 'return', version: v })}
                >
                  {t('library.protocols.protocolVersionsPanel.return')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={() => onDialog({ kind: 'approve', version: v })}
                >
                  {stage === 'qa'
                    ? t(
                        'library.protocols.protocolVersionsPanel.approveAndRelease',
                      )
                    : t('library.protocols.protocolVersionsPanel.approve')}
                </Button>
              </>
            ) : null}
            {a.pending && canWithdraw(a.pending, userId, role) ? (
              <Button
                size="sm"
                variant="quiet"
                disabled={busy}
                onClick={() => onDialog({ kind: 'withdraw', version: v })}
              >
                {t('library.protocols.protocolVersionsPanel.withdraw')}
              </Button>
            ) : null}
            {v.status === 'in_review' &&
            !a.pending &&
            a.latest?.state === 'approved' &&
            writer ? (
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() => onRelease(v)}
              >
                {t('library.protocols.protocolVersionsPanel.makeEffective')}
              </Button>
            ) : null}
            {(v.status === 'draft' || v.status === 'in_review') &&
            !a.pending &&
            a.latest?.state !== 'approved' &&
            writer ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => onDialog({ kind: 'submit', resume: v })}
              >
                {t('library.protocols.protocolVersionsPanel.submitForApproval')}
              </Button>
            ) : null}
            {v.status === 'effective' ? (
              <Button
                size="sm"
                variant="primary"
                nativeButton={false}
                render={
                  <Link
                    to="/experiments/new"
                    search={{ protocol: protocolRecordId }}
                  />
                }
              >
                {t('library.protocols.protocolVersionsPanel.startExperiment')}
              </Button>
            ) : null}
            <Link
              to="/evidence/$revisionId"
              params={{ revisionId: v.id }}
              className="text-link self-center"
            >
              {t('library.protocols.protocolVersionsPanel.evidence')}
            </Link>
          </span>
        )
      },
      meta: rightAligned<ProtocolVersion>().meta,
    },
  ]
}
