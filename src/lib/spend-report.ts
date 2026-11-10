/**
 * Spend on reagent orders (migration 0100).
 *
 * Every order that has been placed carries, when someone has entered it, a
 * price and a currency. Spend adds those up by project, supplier or month,
 * per currency (a lab may buy in more than one, and no exchange rate is
 * guessed). Orders placed with no price are counted so the totals are never
 * mistaken for the whole story. Lines come from `api.report_spend_lines`.
 */
import type { DataClient } from '#/lib/data-client'
import { csvEscape } from '#/lib/export/delimited'
import { addMoney, monthKey } from '#/lib/report-period'
import type { DateRange, MoneyTotals } from '#/lib/report-period'

export const spendKeys = {
  all: ['spend'] as const,
  lines: (workspaceId: string, from: string, to: string) =>
    ['spend', 'lines', workspaceId, from, to] as const,
}

interface SpendLineWire {
  order_id: string
  number: number
  material_title: string
  supplier_record_id: string | null
  supplier: string | null
  project_id: string | null
  project_title: string | null
  quantity: string | number
  unit: string | null
  status: string
  ordered_at: string
  total_price: string | number | null
  currency: string | null
}

export interface SpendLine {
  orderId: string
  reference: string
  materialTitle: string
  supplierRecordId: string | null
  supplier: string | null
  projectId: string | null
  projectTitle: string | null
  quantity: number
  unit: string | null
  status: string
  orderedAt: string
  totalPrice: number | null
  currency: string | null
}

export function toSpendLine(row: SpendLineWire): SpendLine {
  return {
    orderId: row.order_id,
    reference: `RO-${String(row.number).padStart(4, '0')}`,
    materialTitle: row.material_title,
    supplierRecordId: row.supplier_record_id,
    supplier: row.supplier,
    projectId: row.project_id,
    projectTitle: row.project_title,
    quantity: Number(row.quantity),
    unit: row.unit,
    status: row.status,
    orderedAt: row.ordered_at,
    totalPrice: row.total_price === null ? null : Number(row.total_price),
    currency: row.currency,
  }
}

export async function fetchSpendLines(
  client: DataClient,
  workspaceId: string,
  range: DateRange,
): Promise<SpendLine[]> {
  const rows = await client.rpc<SpendLineWire[]>('report_spend_lines', {
    p_workspace_id: workspaceId,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  })

  return rows.map(toSpendLine)
}

/** What one line is grouped by when spend is totalled: its key and its label. */
export interface SpendKey {
  key: string
  label: string
}

/** A whole period's money: totals per currency and how many orders have no price. */
export interface SpendTotals {
  orders: number
  unpriced: number
  totals: MoneyTotals
}

export type SpendGrouping = 'project' | 'supplier' | 'month'

export interface SpendGroup {
  key: string
  label: string
  orders: number
  /** Orders placed with no price, which the totals leave out. */
  unpriced: number
  totals: MoneyTotals
}

const NONE = '__none__'

export function spendKey(
  line: SpendLine,
  by: SpendGrouping,
  timeZone: string,
): SpendKey {
  if (by === 'project') {
    return {
      key: line.projectId ?? NONE,
      label: line.projectTitle ?? '',
    }
  }

  if (by === 'supplier') {
    const name = line.supplier?.trim() ?? ''

    return {
      key:
        line.supplierRecordId ?? (name ? `name:${name.toLowerCase()}` : NONE),
      label: name,
    }
  }

  const month = monthKey(line.orderedAt, timeZone)

  return { key: month, label: month }
}

/** One row per project, supplier or month. Months run oldest first, the rest by spend. */
export function groupSpend(
  lines: readonly SpendLine[],
  by: SpendGrouping,
  timeZone: string,
): SpendGroup[] {
  const groups = new Map<string, SpendGroup>()

  for (const line of lines) {
    const { key, label } = spendKey(line, by, timeZone)
    let group = groups.get(key)

    if (!group) {
      group = { key, label, orders: 0, unpriced: 0, totals: {} }
      groups.set(key, group)
    }

    group.orders += 1

    if (line.totalPrice === null || !line.currency) group.unpriced += 1
    else addMoney(group.totals, line.totalPrice, line.currency)
  }

  const rows = [...groups.values()]

  if (by === 'month') return rows.sort((a, b) => a.key.localeCompare(b.key))

  const sum = (g: SpendGroup) =>
    Object.values(g.totals).reduce((total, value) => total + value, 0)

  return rows.sort((a, b) => sum(b) - sum(a) || b.orders - a.orders)
}

/** The whole period in one go: totals per currency and how many have no price. */
export function totalSpend(lines: readonly SpendLine[]): SpendTotals {
  const totals: MoneyTotals = {}
  let unpriced = 0

  for (const line of lines) {
    if (line.totalPrice === null || !line.currency) unpriced += 1
    else addMoney(totals, line.totalPrice, line.currency)
  }

  return { orders: lines.length, unpriced, totals }
}

function csv(rows: readonly (readonly string[])[]): string {
  return (
    rows
      .map((row) => row.map((cell) => csvEscape(cell, ',')).join(','))
      .join('\r\n') + '\r\n'
  )
}

/** Every order in the period, one row each. */
export function spendCsv(
  lines: readonly SpendLine[],
  unknown: { project: string; supplier: string },
): string {
  return csv([
    [
      'Order',
      'Ordered',
      'Material',
      'Quantity',
      'Unit',
      'Supplier',
      'Project',
      'Status',
      'Price',
      'Currency',
    ],
    ...lines.map((line) => [
      line.reference,
      line.orderedAt.slice(0, 10),
      line.materialTitle,
      String(line.quantity),
      line.unit ?? '',
      line.supplier ?? unknown.supplier,
      line.projectTitle ?? unknown.project,
      line.status,
      line.totalPrice === null ? '' : line.totalPrice.toFixed(2),
      line.currency ?? '',
    ]),
  ])
}
