/**
 * REG-002: Sample inspector — the right-hand panel rendered inside the
 * registry composition's inspector slot.
 *
 * Shows identity, quantities, units, storage, barcode, low-stock state,
 * chain-of-custody events, linked experiments, linked files and notes, plus
 * the controlled custody actions (receive, consume, transfer, edit, archive,
 * restore). The component is presentational: it owns only its form input
 * state and calls back to the route, which performs the RPCs and invalidates
 * the registry queries. Status is never communicated by colour alone — the
 * StatusBadge carries text and icon, and the low-stock marker is a text label.
 */
import * as React from 'react'
import {
  Archive,
  ArrowRightLeft,
  FlaskConical,
  MinusCircle,
  PackagePlus,
  RotateCcw,
  Pencil,
  AlertTriangle,
} from 'lucide-react'

import {
  InspectorSection,
  Property,
  PropertyList,
  EmptyHint,
} from '#/components/record'
import { StatusBadge } from '#/components/scientific/status-badge'
import {
  Badge,
  Button,
  ButtonGroup,
  Input,
  Label,
  Textarea,
} from '#/components/ui'
import { cn } from '#/lib/utils'
import { formatDate } from '#/lib/notebook-data'
import { isLowStock } from '#/lib/samples'
import type {
  LinkedExperiment,
  LinkedFile,
  SampleEvent,
  SampleRecord,
} from '#/lib/samples'

export type SampleCustodyAction =
  | {
      kind: 'receive'
      quantity: number
      unit?: string
      location?: string
      notes?: string
    }
  | { kind: 'consume'; quantity: number; notes?: string }
  | { kind: 'transfer'; toLocation: string; notes?: string }
  | {
      kind: 'edit'
      title?: string
      sampleType?: string
      barcode?: string
      storageLocation?: string
      lowStockThreshold?: number
      quantityUnit?: string
      notes?: string
    }
  | { kind: 'archive'; notes?: string }
  | { kind: 'restore'; notes?: string }

export interface SampleInspectorProps {
  sample: SampleRecord | null
  events: SampleEvent[]
  eventsLoading?: boolean
  linkedExperiments: LinkedExperiment[]
  linkedFiles: LinkedFile[]
  linksLoading?: boolean
  /** True while any custody mutation is in flight. */
  actionPending?: boolean
  actionError?: string | null
  onAction: (action: SampleCustodyAction) => void
  className?: string
}

const OPERATION_LABELS: Record<string, string> = {
  create: 'Created',
  receive: 'Received',
  consume: 'Consumed',
  transfer: 'Transferred',
  edit: 'Edited',
  archive: 'Archived',
  restore: 'Restored',
}

function orDash(value: string | null | undefined): string {
  return value && value !== '' ? value : '—'
}

function quantityLabel(sample: SampleRecord): string {
  if (sample.quantity == null) return '—'
  return sample.quantityUnit
    ? `${sample.quantity} ${sample.quantityUnit}`
    : String(sample.quantity)
}

export function SampleInspector({
  sample,
  events,
  eventsLoading,
  linkedExperiments,
  linkedFiles,
  linksLoading,
  actionPending,
  actionError,
  onAction,
  className,
}: SampleInspectorProps) {
  const [quantity, setQuantity] = React.useState('')
  const [unit, setUnit] = React.useState('')
  const [location, setLocation] = React.useState('')
  const [toLocation, setToLocation] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const [editSampleType, setEditSampleType] = React.useState('')
  const [editBarcode, setEditBarcode] = React.useState('')
  const [editStorage, setEditStorage] = React.useState('')
  const [editThreshold, setEditThreshold] = React.useState('')
  const [editUnit, setEditUnit] = React.useState('')

  React.useEffect(() => {
    if (!sample) return
    setUnit(sample.quantityUnit ?? '')
    setLocation(sample.storageLocation ?? '')
    setToLocation('')
    setEditTitle(sample.title)
    setEditSampleType(sample.sampleType ?? '')
    setEditBarcode(sample.barcode ?? '')
    setEditStorage(sample.storageLocation ?? '')
    setEditThreshold(
      sample.lowStockThreshold == null ? '' : String(sample.lowStockThreshold),
    )
    setEditUnit(sample.quantityUnit ?? '')
  }, [sample?.id, sample])

  if (!sample) {
    return (
      <div className={cn('p-4', className)}>
        <EmptyHint>
          Select a sample to inspect its custody and details.
        </EmptyHint>
      </div>
    )
  }

  const archived = sample.archivedAt != null
  const lowStock = isLowStock(sample)

  function resetTransient() {
    setQuantity('')
    setNotes('')
    setToLocation('')
  }

  function submitReceive() {
    const q = Number(quantity)
    if (!Number.isFinite(q) || q <= 0) return
    onAction({
      kind: 'receive',
      quantity: q,
      unit: unit || undefined,
      location: location || undefined,
      notes: notes || undefined,
    })
    resetTransient()
  }

  function submitConsume() {
    const q = Number(quantity)
    if (!Number.isFinite(q) || q <= 0) return
    onAction({ kind: 'consume', quantity: q, notes: notes || undefined })
    resetTransient()
  }

  function submitTransfer() {
    if (!toLocation.trim()) return
    onAction({
      kind: 'transfer',
      toLocation: toLocation.trim(),
      notes: notes || undefined,
    })
    resetTransient()
  }

  function submitEdit() {
    onAction({
      kind: 'edit',
      title: editTitle || undefined,
      sampleType: editSampleType || undefined,
      barcode: editBarcode || undefined,
      storageLocation: editStorage || undefined,
      lowStockThreshold:
        editThreshold === '' ? undefined : Number(editThreshold),
      quantityUnit: editUnit || undefined,
      notes: notes || undefined,
    })
    setEditing(false)
    setNotes('')
  }

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6">
        {/* Identity */}
        <header className="space-y-2 py-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {sample.identifier}
            </span>
            {archived ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Archive className="size-3" aria-hidden /> Archived
              </span>
            ) : null}
          </div>
          <h2 className="text-base font-semibold leading-tight">
            {sample.title}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={sample.status} domain="sample" />
            {lowStock ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
                <AlertTriangle className="size-3" aria-hidden /> Low stock
              </span>
            ) : null}
          </div>
        </header>

        {/* Properties */}
        <InspectorSection title="Details">
          <PropertyList>
            <Property label="Type">{orDash(sample.sampleType)}</Property>
            <Property label="Quantity" mono>
              {quantityLabel(sample)}
            </Property>
            <Property label="Storage" stacked>
              {orDash(sample.storageLocation)}
            </Property>
            <Property label="Barcode" mono>
              {orDash(sample.barcode)}
            </Property>
            <Property label="Low-stock at" mono>
              {sample.lowStockThreshold == null
                ? '—'
                : sample.quantityUnit
                  ? `${sample.lowStockThreshold} ${sample.quantityUnit}`
                  : String(sample.lowStockThreshold)}
            </Property>
            <Property label="Notes">{orDash(sample.notes)}</Property>
            <Property label="Updated">{formatDate(sample.updatedAt)}</Property>
          </PropertyList>
        </InspectorSection>

        {/* Custody actions */}
        {!archived ? (
          <InspectorSection title="Custody actions">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Label className="text-xs text-muted-foreground">
                  Quantity
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="mt-1 h-8"
                    aria-label="Quantity"
                  />
                </Label>
                <Label className="text-xs text-muted-foreground">
                  Unit
                  <Input
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="mt-1 h-8"
                    aria-label="Unit"
                    placeholder="mL, µg…"
                  />
                </Label>
              </div>
              <Label className="text-xs text-muted-foreground">
                Storage location
                <Textarea
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="mt-1 min-h-16 text-xs"
                  aria-label="Storage location"
                  placeholder="Freezer A, Shelf 2"
                  title={location || undefined}
                />
              </Label>
              <Label className="text-xs text-muted-foreground">
                Transfer to
                <Input
                  value={toLocation}
                  onChange={(e) => setToLocation(e.target.value)}
                  className="mt-1 h-8"
                  aria-label="Transfer to location"
                  placeholder="Freezer B, Shelf 1"
                />
              </Label>
              <Label className="text-xs text-muted-foreground">
                Notes
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 min-h-16 text-xs"
                  aria-label="Notes"
                />
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <ButtonGroup className="col-span-2 w-full [&>*]:flex-1">
                  <Button
                    size="sm"
                    onClick={submitReceive}
                    disabled={actionPending}
                  >
                    <PackagePlus className="size-3.5" /> Receive
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={submitConsume}
                    disabled={actionPending}
                  >
                    <MinusCircle className="size-3.5" /> Consume
                  </Button>
                </ButtonGroup>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={submitTransfer}
                  disabled={actionPending || !toLocation.trim()}
                >
                  <ArrowRightLeft className="size-3.5" /> Transfer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing((v) => !v)}
                  disabled={actionPending}
                  aria-expanded={editing}
                >
                  <Pencil className="size-3.5" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="col-span-2"
                  onClick={() =>
                    onAction({ kind: 'archive', notes: notes || undefined })
                  }
                  disabled={actionPending}
                >
                  <Archive className="size-3.5" /> Archive
                </Button>
              </div>

              {editing ? (
                <div className="space-y-2 border-t pt-3">
                  <Label className="text-xs text-muted-foreground">
                    Title
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="mt-1 h-8"
                      aria-label="Edit title"
                    />
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Label className="text-xs text-muted-foreground">
                      Type
                      <Input
                        value={editSampleType}
                        onChange={(e) => setEditSampleType(e.target.value)}
                        className="mt-1 h-8"
                        aria-label="Edit sample type"
                      />
                    </Label>
                    <Label className="text-xs text-muted-foreground">
                      Barcode
                      <Input
                        value={editBarcode}
                        onChange={(e) => setEditBarcode(e.target.value)}
                        className="mt-1 h-8"
                        aria-label="Edit barcode"
                      />
                    </Label>
                  </div>
                  <Label className="text-xs text-muted-foreground">
                    Storage location
                    <Input
                      value={editStorage}
                      onChange={(e) => setEditStorage(e.target.value)}
                      className="mt-1 h-8"
                      aria-label="Edit storage location"
                    />
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Label className="text-xs text-muted-foreground">
                      Low-stock threshold
                      <Input
                        type="number"
                        step="any"
                        value={editThreshold}
                        onChange={(e) => setEditThreshold(e.target.value)}
                        className="mt-1 h-8"
                        aria-label="Edit low-stock threshold"
                      />
                    </Label>
                    <Label className="text-xs text-muted-foreground">
                      Unit
                      <Input
                        value={editUnit}
                        onChange={(e) => setEditUnit(e.target.value)}
                        className="mt-1 h-8"
                        aria-label="Edit unit"
                      />
                    </Label>
                  </div>
                  <Button
                    size="sm"
                    onClick={submitEdit}
                    disabled={actionPending}
                  >
                    Save edits
                  </Button>
                </div>
              ) : null}
            </div>
          </InspectorSection>
        ) : (
          <InspectorSection title="Custody actions">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onAction({ kind: 'restore', notes: notes || undefined })
              }
              disabled={actionPending}
            >
              <RotateCcw className="size-3.5" /> Restore
            </Button>
          </InspectorSection>
        )}

        {actionError ? (
          <InspectorSection title="Action status">
            <p role="alert" className="text-xs text-danger">
              {actionError}
            </p>
          </InspectorSection>
        ) : null}

        {/* Chain of custody */}
        <InspectorSection title="Chain of custody">
          {eventsLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : events.length === 0 ? (
            <EmptyHint>No custody events recorded yet.</EmptyHint>
          ) : (
            <ol className="space-y-2">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="border-l-2 border-primary/30 pl-2.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {OPERATION_LABELS[event.operation] ?? event.operation}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDate(event.createdAt)}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {event.quantityDelta != null ? (
                      <span className="tabular-nums">
                        {event.quantityDelta > 0 ? '+' : ''}
                        {event.quantityDelta}
                        {event.quantityUnit
                          ? ` ${event.quantityUnit}`
                          : ''} → {event.quantityAfter}
                        {event.quantityUnit ? ` ${event.quantityUnit}` : ''}
                      </span>
                    ) : null}
                    {event.fromLocation && event.toLocation ? (
                      <span>
                        {' '}
                        {event.fromLocation} → {event.toLocation}
                      </span>
                    ) : null}
                  </div>
                  {event.notes ? (
                    <p className="mt-1 break-words text-foreground">
                      {event.notes}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </InspectorSection>

        {/* Linked experiments */}
        <InspectorSection title="Linked experiments">
          {linksLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : linkedExperiments.length === 0 ? (
            <EmptyHint>No experiments linked to this sample.</EmptyHint>
          ) : (
            <ul className="space-y-1.5">
              {linkedExperiments.map((exp) => (
                <li
                  key={exp.linkId}
                  className="flex items-center gap-2 text-xs"
                >
                  <FlaskConical className="size-3.5 text-muted-foreground" />
                  <span className="font-mono">{exp.identifier}</span>
                  {exp.title ? (
                    <span className="min-w-0 truncate text-muted-foreground">
                      {exp.title}
                    </span>
                  ) : null}
                  <Badge variant="outline" className="ml-auto">
                    {exp.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </InspectorSection>

        {/* Linked files */}
        <InspectorSection title="Files">
          {linksLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : linkedFiles.length === 0 ? (
            <EmptyHint>No files linked to this sample.</EmptyHint>
          ) : (
            <ul className="space-y-1.5">
              {linkedFiles.map((file) => (
                <li
                  key={file.linkId}
                  className="flex items-center gap-2 text-xs"
                >
                  <span className="font-mono">{file.identifier}</span>
                  {file.displayName ? (
                    <span className="min-w-0 truncate text-muted-foreground">
                      {file.displayName}
                    </span>
                  ) : null}
                  {file.status ? (
                    <Badge variant="outline" className="ml-auto">
                      {file.status}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </InspectorSection>
      </div>
    </div>
  )
}
