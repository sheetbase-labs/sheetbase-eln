/**
 * Sample details and custody controls rendered inside the registry inspector.
 * The route owns data fetching and mutations; this component owns only form
 * state and presentation.
 *
 * Designed to match the Samples Registry mockup: a single scrollable panel
 * with identity, visual barcode, chain-of-custody timeline, linked
 * experiments, files, notes, and compact custody actions — not a tabbed
 * repeater of table columns.
 */
import * as React from 'react'
import {
  Archive,
  ArrowRightLeft,
  FlaskConical,
  MinusCircle,
  PackagePlus,
  Pencil,
  RotateCcw,
} from 'lucide-react'

import { Inspector } from '#/components/record/inspector'
import {
  EmptyHint,
  FileList,
  InspectorSection,
  LinkedRecordList,
  Property,
  PropertyList,
} from '#/components/record'
import { StatusBadge } from '#/components/scientific/status-badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  ButtonGroup,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Textarea,
} from '#/components/ui'
import { formatDate } from '#/lib/notebook-data'
import type {
  LinkedExperiment,
  LinkedFile,
  SampleEvent,
  SampleRecord,
} from '#/lib/samples'
import { cn } from '#/lib/utils'

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

function fileSize(bytes: number | null): string | undefined {
  if (bytes == null) return undefined
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// --------------------------------------------------------------------------- //
// Visual barcode — CSS-based 1D barcode bars derived from the barcode string. //
// --------------------------------------------------------------------------- //

function VisualBarcode({ value }: { value: string }) {
  const bars = React.useMemo(() => {
    // Deterministic bar widths from char codes
    const widths: number[] = []
    for (const char of value) {
      const code = char.charCodeAt(0)
      widths.push((code % 3) + 1) // 1-3px black bar
      widths.push(((code >> 2) % 2) + 1) // 1-2px gap
    }
    return widths
  }, [value])

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex h-10 items-center overflow-hidden rounded border bg-white px-2">
        <div className="flex h-full items-stretch gap-0">
          {bars.map((w, i) => (
            <div
              key={i}
              className={cn(i % 2 === 0 ? 'bg-black' : 'bg-white')}
              style={{ width: `${w}px` }}
            />
          ))}
        </div>
      </div>
      <span className="font-mono text-[0.65rem] tracking-wide text-muted-foreground">
        {value}
      </span>
    </div>
  )
}

// --------------------------------------------------------------------------- //
// Custody timeline — compact vertical timeline with operation, delta, date.  //
// --------------------------------------------------------------------------- //

function CustodyTimeline({
  events,
  loading,
}: {
  events: SampleEvent[]
  loading: boolean
}) {
  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading…</p>
  }
  if (events.length === 0) {
    return <EmptyHint>No custody events recorded yet.</EmptyHint>
  }
  const recent = events.slice(0, 5)
  return (
    <ol className="relative ml-1 space-y-2.5 border-l border-border pl-3">
      {recent.map((event) => (
        <li key={event.id} className="relative text-xs">
          <span className="absolute -left-[0.4rem] top-[0.15rem] size-1.5 rounded-full border border-primary bg-background" />
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium">
              {OPERATION_LABELS[event.operation] ?? event.operation}
            </span>
            <span className="shrink-0 text-[0.65rem] text-muted-foreground">
              {formatDate(event.createdAt)}
            </span>
          </div>
          {event.quantityDelta != null ? (
            <p className="mt-0.5 tabular-nums text-muted-foreground">
              {event.quantityDelta > 0 ? '+' : ''}
              {event.quantityDelta}
              {event.quantityUnit ? ` ${event.quantityUnit}` : ''} →{' '}
              {event.quantityAfter}
              {event.quantityUnit ? ` ${event.quantityUnit}` : ''}
            </p>
          ) : null}
          {event.fromLocation || event.toLocation ? (
            <p className="mt-0.5 text-muted-foreground">
              {orDash(event.fromLocation)} → {orDash(event.toLocation)}
            </p>
          ) : null}
          {event.notes ? (
            <p className="mt-0.5 italic text-muted-foreground">{event.notes}</p>
          ) : null}
        </li>
      ))}
      {events.length > 5 ? (
        <li className="text-[0.65rem] text-muted-foreground">
          +{events.length - 5} more events
        </li>
      ) : null}
    </ol>
  )
}

// --------------------------------------------------------------------------- //
// Main component                                                              //
// --------------------------------------------------------------------------- //

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
  const [showActions, setShowActions] = React.useState(false)

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
    setShowActions(false)
  }, [sample])

  if (!sample) {
    return (
      <Inspector
        title="Sample"
        tabs={[]}
        state="no-selection"
        className={className}
      />
    )
  }

  const archived = sample.archivedAt != null

  function resetTransient() {
    setQuantity('')
    setNotes('')
    setToLocation('')
  }

  function submitReceive() {
    const value = Number(quantity)
    if (!Number.isFinite(value) || value <= 0) return
    onAction({
      kind: 'receive',
      quantity: value,
      unit: unit || undefined,
      location: location || undefined,
      notes: notes || undefined,
    })
    resetTransient()
  }

  function submitConsume() {
    const value = Number(quantity)
    if (!Number.isFinite(value) || value <= 0) return
    onAction({ kind: 'consume', quantity: value, notes: notes || undefined })
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

  const experimentItems = linkedExperiments.map((experiment) => ({
    id: experiment.linkId,
    type: 'Experiment',
    title: experiment.title ?? experiment.identifier,
    meta:
      experiment.title == null
        ? experiment.status
        : `${experiment.identifier} · ${experiment.status}`,
    icon: FlaskConical,
  }))
  const fileItems = linkedFiles.map((file) => ({
    id: file.linkId,
    name: file.displayName ?? file.identifier,
    meta: file.identifier,
    size: fileSize(file.byteSize),
  }))

  // Single-panel content matching the mockup layout
  const panelContent = (
    <div className="space-y-0">
      {/* Identity properties */}
      <InspectorSection title="Identity">
        <PropertyList>
          <Property label="Sample ID" mono>
            {sample.identifier}
          </Property>
          <Property label="Type">{orDash(sample.sampleType)}</Property>
          <Property label="Quantity" mono>
            {quantityLabel(sample)}
          </Property>
          <Property label="Storage">{orDash(sample.storageLocation)}</Property>
          {sample.lowStockThreshold != null ? (
            <Property label="Low-stock at" mono>
              {`${sample.lowStockThreshold}${sample.quantityUnit ? ` ${sample.quantityUnit}` : ''}`}
            </Property>
          ) : null}
          <Property label="Updated">{formatDate(sample.updatedAt)}</Property>
        </PropertyList>
      </InspectorSection>

      {/* Visual barcode */}
      {sample.barcode ? (
        <InspectorSection title="Barcode">
          <VisualBarcode value={sample.barcode} />
        </InspectorSection>
      ) : null}

      {/* Chain of custody timeline */}
      <InspectorSection title="Chain of custody">
        <CustodyTimeline events={events} loading={eventsLoading ?? false} />
      </InspectorSection>

      {/* Linked experiments */}
      <InspectorSection
        title="Linked experiments"
        action={
          linkedExperiments.length > 0 ? (
            <span className="text-[0.65rem] leading-none text-muted-foreground">
              {linkedExperiments.length}
            </span>
          ) : null
        }
      >
        {linksLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <LinkedRecordList items={experimentItems} />
        )}
      </InspectorSection>

      {/* Files */}
      <InspectorSection
        title="Files"
        action={
          linkedFiles.length > 0 ? (
            <span className="text-[0.65rem] leading-none text-muted-foreground">
              {linkedFiles.length}
            </span>
          ) : null
        }
      >
        {linksLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <FileList items={fileItems} />
        )}
      </InspectorSection>

      {/* Notes */}
      <InspectorSection title="Notes">
        {sample.notes ? (
          <p className="mb-2 whitespace-pre-wrap text-xs text-foreground">
            {sample.notes}
          </p>
        ) : null}
        <Textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="min-h-12 text-xs"
          placeholder="Add a note…"
          aria-label="Add a note"
        />
      </InspectorSection>

      {/* Custody actions — compact, collapsible */}
      <InspectorSection title="Actions">
        {archived ? (
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
        ) : (
          <div className="space-y-2">
            {!showActions ? (
              <div className="flex flex-wrap gap-1.5">
                <ButtonGroup>
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
                  onClick={() => setShowActions((v) => !v)}
                  disabled={actionPending}
                  aria-expanded={showActions}
                >
                  <Pencil className="size-3.5" /> More
                </Button>
              </div>
            ) : (
              <FieldGroup className="gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <Field>
                    <FieldLabel htmlFor="sample-custody-quantity">
                      Quantity
                    </FieldLabel>
                    <Input
                      id="sample-custody-quantity"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                      className="h-8"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="sample-custody-unit">Unit</FieldLabel>
                    <Input
                      id="sample-custody-unit"
                      value={unit}
                      onChange={(event) => setUnit(event.target.value)}
                      className="h-8"
                      placeholder="mL, µg…"
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="sample-custody-location">
                    Storage location
                  </FieldLabel>
                  <Input
                    id="sample-custody-location"
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    className="h-8"
                    placeholder="Freezer A, Shelf 2"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sample-custody-transfer">
                    Transfer to
                  </FieldLabel>
                  <Input
                    id="sample-custody-transfer"
                    value={toLocation}
                    onChange={(event) => setToLocation(event.target.value)}
                    className="h-8"
                    placeholder="Freezer B, Shelf 1"
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-1.5">
                  <ButtonGroup>
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
                    onClick={() => {
                      setEditing((value) => !value)
                      setShowActions(false)
                    }}
                    disabled={actionPending}
                  >
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowActions(false)}
                  >
                    Done
                  </Button>
                </div>

                {editing ? (
                  <FieldGroup className="gap-2 rounded-md border bg-muted/30 p-2.5">
                    <Field>
                      <FieldLabel htmlFor="sample-edit-title">Title</FieldLabel>
                      <Input
                        id="sample-edit-title"
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                        className="h-8"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field>
                        <FieldLabel htmlFor="sample-edit-type">Type</FieldLabel>
                        <Input
                          id="sample-edit-type"
                          value={editSampleType}
                          onChange={(event) =>
                            setEditSampleType(event.target.value)
                          }
                          className="h-8"
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="sample-edit-barcode">
                          Barcode
                        </FieldLabel>
                        <Input
                          id="sample-edit-barcode"
                          value={editBarcode}
                          onChange={(event) =>
                            setEditBarcode(event.target.value)
                          }
                          className="h-8"
                        />
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel htmlFor="sample-edit-storage">
                        Storage location
                      </FieldLabel>
                      <Input
                        id="sample-edit-storage"
                        value={editStorage}
                        onChange={(event) => setEditStorage(event.target.value)}
                        className="h-8"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field>
                        <FieldLabel htmlFor="sample-edit-threshold">
                          Low-stock threshold
                        </FieldLabel>
                        <Input
                          id="sample-edit-threshold"
                          type="number"
                          step="any"
                          value={editThreshold}
                          onChange={(event) =>
                            setEditThreshold(event.target.value)
                          }
                          className="h-8"
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="sample-edit-unit">Unit</FieldLabel>
                        <Input
                          id="sample-edit-unit"
                          value={editUnit}
                          onChange={(event) => setEditUnit(event.target.value)}
                          className="h-8"
                        />
                      </Field>
                    </div>
                    <Button
                      size="sm"
                      onClick={submitEdit}
                      disabled={actionPending}
                    >
                      Save edits
                    </Button>
                  </FieldGroup>
                ) : null}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-fit text-destructive"
                      disabled={actionPending}
                    >
                      <Archive className="size-3.5" /> Archive
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Archive this sample?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The sample will be removed from the active registry. It
                        can be restored later.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          onAction({
                            kind: 'archive',
                            notes: notes || undefined,
                          })
                        }
                      >
                        Archive sample
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </FieldGroup>
            )}
          </div>
        )}
        {actionError ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {actionError}
          </p>
        ) : null}
      </InspectorSection>
    </div>
  )

  return (
    <Inspector
      recordType="Sample"
      title={sample.title}
      status={<StatusBadge status={sample.status} domain="sample" />}
      tabs={[{ id: 'panel', label: 'Details', content: panelContent }]}
      className={className}
    />
  )
}
