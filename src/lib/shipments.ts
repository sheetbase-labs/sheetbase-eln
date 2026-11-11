/**
 * Shipments (migration 0077): a box leaving the lab or arriving at it, with a
 * manifest of what is in it. Manifest lines name records of any kind or free
 * text.
 *
 * Reads go straight to the tables under row-level security; every change goes
 * through an RPC so the steps and who may take them stay in the database.
 */
import { z } from 'zod'

import type { DataClient } from '#/lib/data-client'

export const shipmentKeys = {
  all: ['shipments'] as const,
  list: ['shipments', 'list'] as const,
  counts: ['shipments', 'counts'] as const,
  items: (shipmentId: string) => ['shipments', 'items', shipmentId] as const,
}

export const SHIPMENT_STATUSES = [
  'draft',
  'in_transit',
  'received',
  'cancelled',
] as const

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number]

export type ShipmentDirection = 'outbound' | 'inbound'

const shipmentStatusSchema = z.enum(SHIPMENT_STATUSES)

export function asShipmentStatus(value: string): ShipmentStatus {
  return shipmentStatusSchema.safeParse(value).data ?? 'draft'
}

/** A shipment still on its way to being finished. */
export function isOpenShipment(status: ShipmentStatus): boolean {
  return status === 'draft' || status === 'in_transit'
}

export function shipmentReference(number: number): string {
  return `SHP-${String(number).padStart(4, '0')}`
}

export interface ShipmentRow {
  id: string
  number: number
  direction: ShipmentDirection
  status: ShipmentStatus
  counterparty: string
  carrier: string | null
  tracking_reference: string | null
  shipped_on: string | null
  expected_on: string | null
  received_at: string | null
  condition_note: string | null
  notes: string | null
  cancel_reason: string | null
  created_by: string
  created_at: string
  project_id: string | null
}

interface ShipmentWire extends Omit<ShipmentRow, 'status' | 'direction'> {
  status: string
  direction: string
}

const SHIPMENT_COLUMNS =
  'id,number,direction,status,counterparty,carrier,tracking_reference,shipped_on,expected_on,received_at,condition_note,notes,cancel_reason,created_by,created_at,project_id'

export async function fetchShipments(
  client: DataClient,
): Promise<ShipmentRow[]> {
  const rows = await client.list<ShipmentWire>(
    'shipments',
    `?select=${SHIPMENT_COLUMNS}&order=number.desc&limit=2000`,
  )

  return rows.map((r) => ({
    ...r,
    status: asShipmentStatus(r.status),
    direction: r.direction === 'inbound' ? 'inbound' : 'outbound',
  }))
}

export interface ShipmentItem {
  id: string
  position: number
  record_id: string | null
  identifier: string | null
  title: string
  kind: string | null
  quantity: string | number | null
  unit: string | null
  note: string | null
  received: boolean | null
  received_note: string | null
}

export async function fetchShipmentItems(
  client: DataClient,
  shipmentId: string,
): Promise<ShipmentItem[]> {
  return client.list<ShipmentItem>(
    'shipment_items',
    `?shipment_id=eq.${shipmentId}&order=position.asc&select=id,position,record_id,identifier,title,kind,quantity,unit,note,received,received_note`,
  )
}

/** One manifest line as it is typed in before the shipment is saved. */
export interface ManifestLine {
  key: string
  record_id: string | null
  identifier: string | null
  title: string
  quantity: string
  unit: string
  note: string
}

export function manifestPayload(lines: readonly ManifestLine[]) {
  return lines.flatMap((l) =>
    l.record_id || l.title.trim() !== ''
      ? [
          {
            record_id: l.record_id,
            title: l.title.trim() === '' ? null : l.title.trim(),
            quantity: l.quantity.trim() === '' ? null : Number(l.quantity),
            unit: l.unit.trim() === '' ? null : l.unit.trim(),
            note: l.note.trim() === '' ? null : l.note.trim(),
          },
        ]
      : [],
  )
}

export async function createShipment(
  client: DataClient,
  input: {
    direction: ShipmentDirection
    counterparty: string
    carrier: string
    trackingReference: string
    expectedOn: string
    notes: string
    projectId: string | null
    lines: readonly ManifestLine[]
  },
): Promise<ShipmentRow> {
  return client.rpc<ShipmentRow>('create_shipment', {
    p_direction: input.direction,
    p_counterparty: input.counterparty,
    p_items: manifestPayload(input.lines),
    p_carrier: input.carrier.trim() || null,
    p_tracking_reference: input.trackingReference.trim() || null,
    p_expected_on: input.expectedOn || null,
    p_notes: input.notes.trim() || null,
    p_project_id: input.projectId,
  })
}

export async function markShipmentInTransit(
  client: DataClient,
  input: {
    shipmentId: string
    shippedOn: string
    carrier: string
    trackingReference: string
    expectedOn: string
  },
): Promise<void> {
  await client.rpc<unknown>('mark_shipment_in_transit', {
    p_shipment_id: input.shipmentId,
    p_shipped_on: input.shippedOn || null,
    p_carrier: input.carrier.trim() || null,
    p_tracking_reference: input.trackingReference.trim() || null,
    p_expected_on: input.expectedOn || null,
  })
}

export async function receiveShipment(
  client: DataClient,
  input: {
    shipmentId: string
    results: Array<{ item_id: string; received: boolean; note: string | null }>
    conditionNote: string
  },
): Promise<void> {
  await client.rpc<unknown>('receive_shipment', {
    p_shipment_id: input.shipmentId,
    p_results: input.results,
    p_condition_note: input.conditionNote.trim() || null,
  })
}

export async function cancelShipment(
  client: DataClient,
  shipmentId: string,
  reason: string,
): Promise<void> {
  await client.rpc<unknown>('cancel_shipment', {
    p_shipment_id: shipmentId,
    p_reason: reason.trim() || null,
  })
}

export function messageOf(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A failed shipment write is a caught throw, untyped by definition; an Error supplies its message and anything else falls back.
  error: unknown,
  fallback: string,
): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** How many manifest lines each shipment carries, for the list. */
export async function fetchManifestCounts(
  client: DataClient,
): Promise<Map<string, number>> {
  const rows = await client.list<{ shipment_id: string }>(
    'shipment_items',
    '?select=shipment_id&limit=50000',
  )

  const counts = new Map<string, number>()

  for (const row of rows) {
    counts.set(row.shipment_id, (counts.get(row.shipment_id) ?? 0) + 1)
  }

  return counts
}
