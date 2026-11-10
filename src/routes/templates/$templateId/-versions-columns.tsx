import { Status } from '#/components/ui/status'
import { Icon } from '#/components/icons'
import { formatDate } from '#/lib/notebook-data'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import type { TemplateChangeSetEntry } from '#/lib/notebook-template-change-set'
import type { ApprovalRequest } from '#/lib/approval-requests'
import { rightAligned } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { t } from '#/copy'

import { TAG_LABEL, TAG_TONE, formatClock } from './-versions-data'

function ChangeValue({ value }: { value: string | undefined }) {
  if (value === undefined || value === '') {
    return <span className="text-fg-muted">—</span>
  }

  return (
    <span className="mono block max-w-[180px] truncate" title={value}>
      {value}
    </span>
  )
}

/** The definition changes one version recorded, as a table's columns. */
export const changeSetColumns: RegistryColumn<TemplateChangeSetEntry>[] = [
  {
    id: 'change',
    header: t('library.templates.versions.change'),
    meta: { headerClassName: 'pl-3!', cellClassName: 'pl-3!' },
    cell: ({ row }) => (
      <Status tone={TAG_TONE[row.original.tag]}>
        {TAG_LABEL[row.original.tag]}
      </Status>
    ),
  },
  {
    id: 'target',
    header: t('library.templates.versions.target'),
    meta: { cellClassName: 'text-fg-muted' },
    cell: ({ row }) =>
      `${row.original.label}${row.original.field ? ` · ${row.original.field}` : ''}`,
  },
  {
    id: 'before',
    header: t('library.templates.versions.before'),
    cell: ({ row }) => <ChangeValue value={row.original.before} />,
  },
  {
    id: 'after',
    header: t('library.templates.versions.after'),
    meta: { headerClassName: 'pr-3!', cellClassName: 'pr-3!' },
    cell: ({ row }) => <ChangeValue value={row.original.after} />,
  },
]

/** The versions table's columns; `records` counts the notebooks on each
 * version, read from the usage matrix. */
export function versionColumns(
  ownerLabel: (userId: string) => string,
  records: Map<string, number>,
  currentId: string | undefined,
  approvals: Map<string, ApprovalRequest[]>,
  changeText: Map<string, string>,
): RegistryColumn<NotebookTemplateVersion>[] {
  const stateOf = (version: NotebookTemplateVersion) => {
    if (version.lifecycle === 'draft')
      return {
        tone: 'draft' as const,
        label: t('library.templates.versions.draft'),
      }

    if (version.lifecycle === 'retired')
      return {
        tone: 'stored' as const,
        label: t('library.templates.versions.retired'),
      }

    if (version.id === currentId)
      return {
        tone: 'progress' as const,
        label: t('library.templates.versions.current'),
      }

    return (records.get(version.id) ?? 0) > 0
      ? {
          tone: 'ok' as const,
          label: t('library.templates.versions.publishedStillInUse'),
        }
      : {
          tone: 'stored' as const,
          label: t('library.templates.versions.published'),
        }
  }

  return [
    {
      id: 'version',
      header: t('library.templates.versions.version'),
      meta: { cellClassName: 'font-medium' },
      cell: ({ row }) => `v${row.original.version}`,
    },
    {
      id: 'status',
      header: t('library.templates.versions.status'),
      cell: ({ row }) => {
        const state = stateOf(row.original)

        return <Status tone={state.tone}>{state.label}</Status>
      },
    },
    {
      id: 'published',
      header: t('library.templates.versions.published'),
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) =>
        row.original.publishedAt
          ? formatDate(row.original.publishedAt)
          : `Rev. ${row.original.revision}${
              row.original.updatedAt
                ? ` · ${formatClock(row.original.updatedAt)}`
                : ''
            }`,
    },
    {
      id: 'by',
      header: t('library.templates.versions.by'),
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) => {
        const id =
          row.original.publishedByUserId ?? row.original.updatedByUserId

        return id ? ownerLabel(id) : '—'
      },
    },
    {
      id: 'approved',
      header: t('library.templates.versions.approvedBy'),
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) => {
        const approved = (approvals.get(row.original.id) ?? []).find(
          (r) => r.state === 'approved',
        )

        const ids = approved?.approved_by_user_ids ?? []

        if (!ids.length) return '—'

        return (
          <span className="inline-flex items-center gap-1">
            <Icon name="lock" size={12} />
            {ids.map(ownerLabel).join(', ')}
          </span>
        )
      },
    },
    {
      id: 'change',
      header: t('library.templates.versions.change'),
      meta: { cellClassName: 'max-w-[320px] whitespace-normal' },
      cell: ({ row }) => changeText.get(row.original.id) ?? '',
    },
    {
      id: 'records',
      header: t('library.templates.versions.records'),
      meta: rightAligned<NotebookTemplateVersion>().meta,
      cell: ({ row }) =>
        row.original.lifecycle === 'draft'
          ? '—'
          : (records.get(row.original.id) ?? 0),
    },
  ]
}
