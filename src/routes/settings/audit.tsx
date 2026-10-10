import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Input } from '#/components/v3/ui/input'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { SettingsHeader } from '#/components/v3/settings/settings-page'
import { createDataClient } from '#/lib/data-client'
import { useUserNames } from '#/lib/user-names'
import { adminQueryKeys, fetchWorkspaceActivity } from '#/lib/workspace-admin'

/** UI port (roadmap-4/ui-app3): the audit log reads the append-only change
 * events for the workspace. Entries cannot be edited or deleted; the export is
 * the rows shown. */
export const Route = createFileRoute('/settings/audit')({
  component: Audit,
})

const dataClient = createDataClient()
const LIMIT = 200

function Audit() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const [q, setQ] = useState('')
  const [operation, setOperation] = useState<string>('')

  const activity = useQuery({
    queryKey: [...adminQueryKeys.activity(workspaceId), LIMIT],
    queryFn: () => fetchWorkspaceActivity(dataClient, workspaceId, LIMIT),
    enabled: Boolean(workspaceId),
  })
  const rows = activity.data ?? []
  const names = useUserNames(
    rows.map((r) => r.actorUserId ?? '').filter(Boolean),
    context.user,
  )

  const operations = useMemo(
    () => [...new Set(rows.map((r) => r.operation))].sort(),
    [rows],
  )
  const needle = q.trim().toLowerCase()
  const visible = rows.filter((r) => {
    if (operation && r.operation !== operation) return false
    if (!needle) return true
    return [
      r.operation,
      r.entityType,
      r.recordId ?? '',
      r.entityUuid ?? '',
      paths(r.payload),
    ]
      .join(' ')
      .toLowerCase()
      .includes(needle)
  })

  const exportCsv = () => {
    const header = [
      'when',
      'sequence',
      'actor',
      'operation',
      'entity',
      'record',
      'project',
    ]
    const lines = visible.map((r) =>
      [
        r.createdAt,
        String(r.sequence),
        r.actorUserId ? names.userLabel(r.actorUserId) : 'system',
        r.operation,
        r.entityType,
        r.recordId ?? '',
        r.projectId ?? '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    )
    const blob = new Blob([[header.join(','), ...lines].join('\n')], {
      type: 'text/csv',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'audit-log.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <SettingsHeader
        title={
          <>
            Audit log{' '}
            <span className="ml-1 font-sans text-label font-normal text-fg-muted">
              {context.workspace?.name ?? 'Workspace'} · all projects
            </span>
          </>
        }
        border={false}
        actions={
          <>
            <Button onClick={() => activity.refetch()}>Refresh</Button>
            <Button
              variant="primary"
              disabled={!visible.length}
              onClick={exportCsv}
            >
              Export CSV
            </Button>
          </>
        }
      >
        Entries can’t be edited or deleted; each carries the actor, the object
        and the change.
      </SettingsHeader>
      <div
        role="toolbar"
        className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 md:px-6"
      >
        <select
          aria-label="Operation"
          className="h-[26px] rounded-md border border-border bg-surface px-2 text-label text-fg"
          value={operation}
          onChange={(e) => setOperation(e.target.value)}
        >
          <option value="">All operations</option>
          {operations.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <label className="block w-[240px]">
          <span className="sr-only">Search audit log</span>
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search object, value or reason"
            className="h-[26px] text-label"
          />
        </label>
        <span className="flex-1" />
        <span className="num whitespace-nowrap text-label text-fg-muted">
          {visible.length === rows.length
            ? `${rows.length} entries`
            : `${visible.length} of ${rows.length} entries`}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table aria-label="Audit log" className="max-xl:min-w-[1000px]">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Operation</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Project</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-fg-muted">
                  {r.createdAt.slice(0, 19).replace('T', ' ')}
                </TableCell>
                <TableCell>
                  {r.actorUserId ? names.userLabel(r.actorUserId) : 'system'}
                </TableCell>
                <TableCell>{r.operation}</TableCell>
                <TableCell>{r.entityType}</TableCell>
                <TableCell className="max-w-[240px] whitespace-normal text-fg-muted">
                  {describeChange(r.payload)}
                </TableCell>
                <TableCell className="max-w-[160px] whitespace-normal text-fg-muted">
                  {reasonOf(r.payload)}
                </TableCell>
                <TableCell className="mono text-[11px]">
                  {r.recordId ?? '—'}
                </TableCell>
                <TableCell className="mono text-[11px] text-fg-muted">
                  {r.projectId ? r.projectId.slice(0, 8) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!activity.isLoading && visible.length === 0 ? (
          <div className="px-4 py-4 md:px-6">
            <EmptyState
              icon="search"
              title="No audit entries match"
              body="Clear the search and the operation filter to see the whole log."
            />
          </div>
        ) : null}
      </div>
      <div className="border-t border-border-subtle px-4 py-3 md:px-6">
        <Muted>
          Showing the most recent {LIMIT} entries in this workspace. The export
          writes the rows shown.
        </Muted>
      </div>
    </>
  )
}

/** The first field-level change in an event payload, with its count. */
function describeChange(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '—'
  const changes = (payload as { changes?: unknown }).changes
  if (!changes || typeof changes !== 'object') return '—'
  const entries = Object.entries(changes as Record<string, unknown>)
  if (entries.length === 0) return '—'
  const [field, raw] = entries[0]
  const pair = (raw ?? {}) as { from?: unknown; to?: unknown }
  const from = pair.from == null ? '∅' : String(pair.from)
  const to = pair.to == null ? '∅' : String(pair.to)
  const extra = entries.length > 1 ? ` (+${entries.length - 1})` : ''
  return `${field}: ${from} → ${to}${extra}`
}

/** The reason recorded on an event, when the operation needs one. */
function reasonOf(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const reason = (payload as { reason?: unknown }).reason
    if (typeof reason === 'string' && reason.trim()) return reason
  }
  return '—'
}

function paths(value: unknown): string {
  if (value == null) return ''
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return value.map(paths).join(' ')
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${k} ${paths(v)}`)
    .join(' ')
}
