/**
 * Making a solution from lots (migration 0064).
 *
 * A buffer, medium or any other prep uses up quantities of ingredient lots and
 * becomes a new lot of its own. `prepare_solution` does all of it in one step:
 * each ingredient is drawn down through its own ledger, the new lot is registered,
 * and the new lot is linked to what went into it. Its expiry defaults to the
 * earliest expiry among the ingredients.
 *
 * Reads go straight to `api.material_ingredients` under row-level security.
 */

import { daysUntilDate } from '#/lib/calendar-days'
import type { DataClient } from '#/lib/data-client'
import { toReagentFromWire } from '#/lib/reagent-data'
import type { Reagent } from '#/lib/reagent-data'
import type { RecordWire } from '#/lib/notebook-data'
import { now as appNow } from '#/lib/clock'

export interface SolutionIngredient {
  /** The ingredient lot. */
  recordId: string
  /** In the unit the lot is stocked in. */
  quantity: number
}

export interface PrepareSolutionInput {
  projectId: string
  title: string
  lot: string
  quantity: number
  unit?: string | null
  /** ISO date YYYY-MM-DD. Leave out to use the earliest ingredient expiry. */
  expiry?: string | null
  storage?: string | null
  note?: string | null
  ingredients: SolutionIngredient[]
}

export interface PreparedSolution {
  id: string
  identifier: string
  title: string
  projectId: string | null
  lot: string
  expiry: string | null
  quantity: number
  unit: string | null
}

export function prepareSolution(
  client: DataClient,
  input: PrepareSolutionInput,
): Promise<PreparedSolution> {
  return client.rpc<PreparedSolution>('prepare_solution', {
    p_project_id: input.projectId,
    p_title: input.title,
    p_lot: input.lot,
    p_quantity: input.quantity,
    p_unit: input.unit ?? null,
    p_ingredients: input.ingredients,
    p_expiry: input.expiry || null,
    p_storage: input.storage || null,
    p_note: input.note || null,
  })
}

/** The earliest of the given ISO dates, ignoring lots with no expiry. */
export function earliestExpiry(
  expiries: ReadonlyArray<string | null | undefined>,
): string | null {
  let earliest: string | null = null

  for (const expiry of expiries) {
    if (expiry && (earliest === null || expiry < earliest)) earliest = expiry
  }

  return earliest
}

/** A lot can go into a solution while it is in date, not held, and has stock. */
export function isUsableIngredient(
  lot: Pick<Reagent, 'status' | 'quantity' | 'expiry' | 'archivedAt'>,
  now: Date = appNow(),
): boolean {
  if (lot.archivedAt) return false

  if (lot.status !== 'available' && lot.status !== 'reserved') return false

  if ((lot.quantity ?? 0) <= 0) return false

  if (lot.expiry && (daysUntilDate(lot.expiry, now) ?? 0) < 0) return false

  return true
}

/** Lots that can go into a solution, matched on name, ID or lot number. */
export async function searchIngredientLots(
  client: DataClient,
  text: string,
  limit = 12,
): Promise<Reagent[]> {
  const cleaned = text.replace(/[,&()*."\\%]/g, ' ').trim()

  const parts = [
    'kind=eq.material',
    'deleted_at=is.null',
    'archived_at=is.null',
    'status=in.(available,reserved)',
  ]

  if (cleaned) {
    const pattern = encodeURIComponent(`"*${cleaned}*"`)
    parts.push(
      `or=(identifier.ilike.${pattern},title.ilike.${pattern},properties->>lot.ilike.${pattern})`,
    )
  }

  parts.push('order=title.asc,identifier.asc', `limit=${limit}`)
  const rows = await client.list<RecordWire>('records', `?${parts.join('&')}`)

  return rows.map(toReagentFromWire).filter((lot) => isUsableIngredient(lot))
}

interface IngredientWire {
  id: string
  ingredient_record_id: string | null
  quantity: string | number
  unit: string | null
  ingredient_identifier: string
  ingredient_title: string
  ingredient_lot: string | null
  ingredient_expiry: string | null
  position: number
}

export interface MadeFromIngredient {
  id: string
  /** NULL once the ingredient lot has been deleted. */
  recordId: string | null
  identifier: string
  title: string
  lot: string | null
  expiry: string | null
  quantity: number
  unit: string | null
}

/** What a solution was made from, in the order it was added. */
export async function fetchMadeFrom(
  client: DataClient,
  productRecordId: string,
): Promise<MadeFromIngredient[]> {
  const rows = await client.list<IngredientWire>(
    'material_ingredients',
    `?product_record_id=eq.${encodeURIComponent(productRecordId)}&order=position.asc` +
      `&select=id,ingredient_record_id,quantity,unit,ingredient_identifier,ingredient_title,ingredient_lot,ingredient_expiry,position`,
  )

  return rows.map((row) => ({
    id: row.id,
    recordId: row.ingredient_record_id,
    identifier: row.ingredient_identifier,
    title: row.ingredient_title,
    lot: row.ingredient_lot,
    expiry: row.ingredient_expiry,
    quantity: Number(row.quantity),
    unit: row.unit,
  }))
}

interface PreparedWithWire {
  id: string
  quantity: string | number
  unit: string | null
  created_at: string
  product: { id: string; identifier: string; title: string } | null
}

export interface PreparedWithLot {
  id: string
  productId: string
  identifier: string
  title: string
  quantity: number
  unit: string | null
  createdAt: string
}

/** The solutions that used up part of this lot. */
export async function fetchPreparedWith(
  client: DataClient,
  ingredientRecordId: string,
): Promise<PreparedWithLot[]> {
  const rows = await client.list<PreparedWithWire>(
    'material_ingredients',
    `?ingredient_record_id=eq.${encodeURIComponent(ingredientRecordId)}&order=created_at.desc&limit=100` +
      `&select=id,quantity,unit,created_at,product:records!product_record_id(id,identifier,title)`,
  )

  return rows.flatMap((row) =>
    row.product
      ? [
          {
            id: row.id,
            productId: row.product.id,
            identifier: row.product.identifier,
            title: row.product.title,
            quantity: Number(row.quantity),
            unit: row.unit,
            createdAt: row.created_at,
          },
        ]
      : [],
  )
}

export const solutionQueryKeys = {
  madeFrom: (recordId: string) =>
    ['ui-port', 'materials', 'made-from', recordId] as const,
  preparedWith: (recordId: string) =>
    ['ui-port', 'materials', 'prepared-with', recordId] as const,
  candidates: (text: string) =>
    ['ui-port', 'materials', 'ingredient-lots', text] as const,
}
