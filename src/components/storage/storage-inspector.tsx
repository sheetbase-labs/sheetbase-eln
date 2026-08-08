import { useQuery } from '@tanstack/react-query'
import { Copy, Thermometer, X } from 'lucide-react'
import {
  EmptyHint,
  InspectorSection,
  Property,
  PropertyList,
} from '#/components/record'
import { StatusBadge } from '#/components/scientific'
import { Badge, Button } from '#/components/ui'
import { formatDate, notebookDataClient } from '#/lib/notebook-data'
import type { NotebookRecord } from '#/lib/notebook-data'
import type { SampleEvent } from '#/lib/samples'
import { boxOccupancy, positionStatusDef } from '#/lib/storage'
import type {
  BoxPositionWithSample,
  StorageBox,
  StorageMovement,
} from '#/lib/storage'

export type StorageInspectorAction =
  | { kind: 'move' }
  | { kind: 'remove' }
  | { kind: 'status'; status: 'available' | 'quarantined' | 'missing' }
export interface StorageInspectorProps {
  position: BoxPositionWithSample | null
  box: StorageBox | null
  positions: BoxPositionWithSample[]
  environment?: string | null
  pendingSample: NotebookRecord | null
  movements: StorageMovement[]
  events: SampleEvent[]
  loading?: boolean
  actionPending?: boolean
  actionError?: string | null
  onAction: (action: StorageInspectorAction) => void
  onClose?: () => void
}
interface LinkWire {
  id: string
  link_type: string
  target_record_id: string
  link_metadata?: Record<string, unknown>
}
interface FileWire {
  id: string
  filename?: string
  original_name?: string
  file_size?: number
}

export function StorageInspector({
  position,
  box,
  positions,
  environment,
  pendingSample,
  movements,
  events,
  loading,
  actionPending,
  actionError,
  onAction,
  onClose,
}: StorageInspectorProps) {
  const sampleId = position?.sample?.id
  const links = useQuery({
    queryKey: ['storage-inspector-links', sampleId],
    queryFn: () =>
      notebookDataClient.list<LinkWire>(
        'record_links',
        `?source_record_id=eq.${sampleId}`,
      ),
    enabled: Boolean(sampleId),
  })
  const files = useQuery({
    queryKey: ['storage-inspector-files', sampleId],
    queryFn: () =>
      notebookDataClient.list<FileWire>('files', `?record_id=eq.${sampleId}`),
    enabled: Boolean(sampleId),
  })
  if (!position)
    return (
      <div className="p-4">
        <EmptyHint>
          Select a position to inspect its contents and custody.
        </EmptyHint>
      </div>
    )
  const def = positionStatusDef(position.status)
  const summary = boxOccupancy(positions)
  const sample = position.sample
  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <header className="space-y-2 py-3">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-4">
            <p className="pt-1 text-xs font-medium text-muted-foreground">
              Position {position.label}
            </p>
            {onClose && (
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0"
                aria-label="Close inspector"
                onClick={onClose}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
          <h2 className="max-w-full text-lg leading-snug font-semibold text-balance">
            {sample?.title ?? box?.name ?? 'Storage box'}
          </h2>
          <p className="font-mono text-xs text-muted-foreground">
            {sample ? `Storage box: ${box?.code ?? '—'}` : (box?.code ?? '—')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={def.tone === 'neutral' ? 'outline' : def.tone}>
            {def.glyph} Position: {def.label}
          </Badge>
        </div>
        {sample ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-muted-foreground">
              Sample identifier: {sample.identifier}
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              Sample availability:
              <StatusBadge domain="sample" status={sample.status} />
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {summary.occupied} samples in this box
          </p>
        )}
      </header>
      <InspectorSection title="Environment">
        <div className="flex items-center gap-2">
          <Thermometer className="size-4" />
          <strong className="text-sm">
            {environment ?? 'Environment inherited'}
          </strong>
          <Badge variant="success">In range</Badge>
        </div>
        <svg
          viewBox="0 0 180 35"
          className="mt-2 h-9 w-full text-info"
          role="img"
          aria-label="Decorative stable temperature trend"
        >
          <polyline
            points="0,22 25,18 50,20 75,13 100,17 125,15 150,18 180,14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      </InspectorSection>
      {sample && (
        <InspectorSection title="Sample details">
          <PropertyList>
            <Property label="Sample identifier" mono>
              {sample.identifier}
            </Property>
            <Property label="Barcode" mono>
              <span>
                {sample.barcode ?? '—'}{' '}
                {sample.barcode && (
                  <button
                    type="button"
                    aria-label="Copy barcode"
                    onClick={() =>
                      void navigator.clipboard.writeText(sample.barcode!)
                    }
                  >
                    <Copy className="inline size-3" />
                  </button>
                )}
              </span>
            </Property>
            <Property label="Type">{sample.sampleType ?? '—'}</Property>
          </PropertyList>
        </InspectorSection>
      )}
      <InspectorSection title="Chain of Custody">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : events.length ? (
          <ul className="space-y-3">
            {events.map((event) => (
              <li key={event.id} className="border-l-2 pl-2 text-xs">
                <strong className="capitalize">{event.operation}</strong>
                <span className="block">
                  {event.fromLocation ?? 'Unstored'} → {event.toLocation ?? '—'}
                </span>
                <span className="text-muted-foreground">
                  {event.actorUserId ?? 'System'} ·{' '}
                  {formatDate(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyHint>No custody events.</EmptyHint>
        )}
      </InspectorSection>
      <InspectorSection title="Recent Movements">
        {movements.length ? (
          <ul className="space-y-2">
            {movements.map((item) => (
              <li key={item.id} className="text-xs">
                <strong className="capitalize">{item.operation}</strong> ·{' '}
                {item.fromPath ?? 'Unstored'} → {item.toPath ?? 'Removed'}
                <span className="block text-muted-foreground">
                  {formatDate(item.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyHint>No storage movements.</EmptyHint>
        )}
      </InspectorSection>
      <InspectorSection title="Linked Experiments">
        {links.data?.length ? (
          <ul className="space-y-2">
            {links.data.map((link) => (
              <li key={link.id} className="flex justify-between text-xs">
                <span>
                  {String(link.link_metadata?.label ?? link.link_type)}
                </span>
                <Badge variant="outline">Linked</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyHint>No linked experiments.</EmptyHint>
        )}
      </InspectorSection>
      <InspectorSection title="Files">
        {files.data?.length ? (
          <ul>
            {files.data.map((file) => (
              <li key={file.id} className="flex justify-between text-xs">
                <span>{file.filename ?? file.original_name ?? 'File'}</span>
                <span className="text-muted-foreground">
                  {file.file_size == null
                    ? '—'
                    : `${Math.ceil(file.file_size / 1024)} KB`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyHint>No files.</EmptyHint>
        )}
      </InspectorSection>
      <InspectorSection title="Actions">
        <div className="grid gap-2">
          {pendingSample && position.status === 'available' && (
            <Button
              size="sm"
              disabled={actionPending}
              onClick={() => onAction({ kind: 'move' })}
            >
              Move {pendingSample.identifier} here
            </Button>
          )}
          {sample && (
            <Button
              size="sm"
              variant="outline"
              disabled={actionPending}
              onClick={() => onAction({ kind: 'remove' })}
            >
              Remove sample
            </Button>
          )}
          {position.status === 'quarantined' ||
          position.status === 'missing' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={actionPending}
              onClick={() => onAction({ kind: 'status', status: 'available' })}
            >
              Restore
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={actionPending || Boolean(sample)}
                onClick={() =>
                  onAction({ kind: 'status', status: 'quarantined' })
                }
              >
                Quarantine
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={actionPending || Boolean(sample)}
                onClick={() => onAction({ kind: 'status', status: 'missing' })}
              >
                Mark missing
              </Button>
            </>
          )}
        </div>
        {actionError && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {actionError}
          </p>
        )}
      </InspectorSection>
    </div>
  )
}
