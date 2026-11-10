/**
 * Chemistry in a notebook: a drawn structure, and a reaction with its table.
 *
 * Two block types hold them. A `structure` block keeps one drawing as a molfile.
 * A `reaction` block keeps the drawn scheme and a table with a row
 * for every reactant, reagent, solvent and product. The drawing is the source of
 * truth for what the molecules are; the table is where the amounts go.
 *
 * Everything here is plain data and arithmetic so it can run on the server (to
 * validate and to build the text people search) and be tested without a browser.
 * Reading a drawing (formula, weight, SMILES, the picture) needs the chemistry
 * library and lives in `chemistry-draw.ts`, loaded only where a drawing is shown.
 */
import { z } from 'zod'

export const REACTION_ROLES = [
  'reactant',
  'reagent',
  'solvent',
  'product',
] as const

export type ReactionRole = (typeof REACTION_ROLES)[number]

/** A reaction table row. Amounts are in mg, mL and mmol. */
export interface ReactionRow {
  id: string
  role: ReactionRole
  name: string
  /** Molecular formula, from the drawing or typed. */
  formula?: string
  /** Molecular weight in g/mol, from the drawing or typed. */
  mw?: number | null
  /**
   * Which drawn molecule this row is (its canonical code), so the row keeps its
   * amounts when the drawing is edited. Absent for a row added by hand.
   */
  structureCode?: string
  /** Equivalents against the limiting reactant. For a product: its coefficient. */
  equiv?: number | null
  /** Mass in mg. For a product: the mass actually isolated. */
  massMg?: number | null
  volumeMl?: number | null
  /** g/mL, to turn a liquid's mass into a volume. */
  density?: number | null
  /** mol/L, for a solution: the volume that holds the moles. */
  concentration?: number | null
  note?: string
}

export interface ReactionPayload {
  title?: string
  caption?: string
  /** The drawn scheme, in the drawing library's own text; empty before anything is drawn. */
  drawing: string
  /** The scheme as reaction SMILES, worked out when it is saved, so search can use it. */
  smiles?: string
  rows: ReactionRow[]
  /** The row the others are measured against; the first reactant when unset. */
  limitingId?: string | null
}

export interface StructurePayload {
  title?: string
  caption?: string
  /** The drawing as a molfile; empty before anything is drawn. */
  molfile: string
  name?: string
  /** Worked out from the drawing when it is saved, so search can use them. */
  formula?: string
  smiles?: string
  mw?: number | null
}

export const EMPTY_STRUCTURE_PAYLOAD: StructurePayload = { molfile: '' }
export const EMPTY_REACTION_PAYLOAD: ReactionPayload = { drawing: '', rows: [] }

// ---------------------------------------------------------------------------
// Payload checks (called by the block validators).
// ---------------------------------------------------------------------------

export interface ChemistryIssue {
  field: string
  message: string
}

const MAX_DRAWING_CHARS = 400_000
export const MAX_REACTION_ROWS = 60

/** A value a stored block payload holds: JSON, as the block wrote it. */
type PayloadValue =
  string | number | boolean | null | PayloadValue[] | PayloadObject

/** A block payload: named values, each one the block itself stored. */
type PayloadObject = { [key: string]: PayloadValue | undefined }

/** Named values of any kind; only the shape is checked, never the values. */
const namedValues = z.record(z.string(), z.unknown())

const storedObject = z.custom<PayloadObject>((value) => isObject(value))

function isObject(value: unknown): value is PayloadObject {
  return namedValues.safeParse(value).success
}

const text = z.string()

/** A number or nothing: NaN and Infinity are not amounts a payload may carry. */
const amount = z.number().nullish()

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A block payload is stored JSON of no shape the caller can assume; this validator is the boundary that decides whether it is a structure payload.
export function structureIssues(payload: unknown): ChemistryIssue[] {
  if (!isObject(payload))
    return [{ field: '', message: 'payload must be an object' }]
  const issues: ChemistryIssue[] = []

  if (!text.max(MAX_DRAWING_CHARS).safeParse(payload.molfile).success) {
    issues.push({
      field: 'molfile',
      message: 'molfile must be text of a reasonable size',
    })
  }

  for (const field of ['title', 'caption', 'name', 'formula', 'smiles']) {
    if (
      payload[field] !== undefined &&
      !text.safeParse(payload[field]).success
    ) {
      issues.push({ field, message: `${field} must be a string when present` })
    }
  }

  if (!amount.safeParse(payload.mw).success) {
    issues.push({ field: 'mw', message: 'mw must be a number when present' })
  }

  return issues
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A block payload is stored JSON of no shape the caller can assume; this validator is the boundary that decides whether it is a reaction payload.
export function reactionIssues(payload: unknown): ChemistryIssue[] {
  if (!isObject(payload))
    return [{ field: '', message: 'payload must be an object' }]
  const issues: ChemistryIssue[] = []

  if (!text.max(MAX_DRAWING_CHARS).safeParse(payload.drawing).success) {
    issues.push({
      field: 'drawing',
      message: 'drawing must be text of a reasonable size',
    })
  }

  for (const field of ['title', 'caption', 'smiles']) {
    if (
      payload[field] !== undefined &&
      !text.safeParse(payload[field]).success
    ) {
      issues.push({ field, message: `${field} must be a string when present` })
    }
  }

  const rows = z.array(z.json()).safeParse(payload.rows)

  if (!rows.success || rows.data.length > MAX_REACTION_ROWS) {
    issues.push({
      field: 'rows',
      message: `rows must be a list of up to ${MAX_REACTION_ROWS} rows`,
    })

    return issues
  }

  const seen = new Set<string>()

  for (const [index, row] of rows.data.entries()) {
    const at = `rows[${index}]`
    const rowFields = storedObject.safeParse(row)

    if (!rowFields.success) {
      issues.push({ field: at, message: 'each row must be an object' })

      continue
    }

    const entry = rowFields.data
    const id = text.safeParse(entry.id)

    if (!id.success || id.data === '' || seen.has(id.data)) {
      issues.push({ field: `${at}.id`, message: 'each row needs its own id' })
    } else {
      seen.add(id.data)
    }

    if (!REACTION_ROLES.some((role) => role === entry.role)) {
      issues.push({
        field: `${at}.role`,
        message: `role must be one of ${REACTION_ROLES.join(', ')}`,
      })
    }

    const name = text.max(200).safeParse(entry.name)

    if (!name.success) {
      issues.push({
        field: `${at}.name`,
        message: 'name must be text up to 200 characters',
      })
    }

    for (const field of [
      'mw',
      'equiv',
      'massMg',
      'volumeMl',
      'density',
      'concentration',
    ]) {
      if (!amount.safeParse(entry[field]).success) {
        issues.push({
          field: `${at}.${field}`,
          message: `${field} must be a number`,
        })
      }
    }

    for (const field of ['formula', 'structureCode', 'note']) {
      if (entry[field] !== undefined && !text.safeParse(entry[field]).success) {
        issues.push({
          field: `${at}.${field}`,
          message: `${field} must be a string`,
        })
      }
    }
  }

  const limitingId = text.safeParse(payload.limitingId)

  if (
    payload.limitingId !== undefined &&
    payload.limitingId !== null &&
    !(limitingId.success && seen.has(limitingId.data))
  ) {
    issues.push({
      field: 'limitingId',
      message: 'limitingId must be the id of one of the rows',
    })
  }

  return issues
}

// ---------------------------------------------------------------------------
// The table's arithmetic.
// ---------------------------------------------------------------------------

export interface ComputedRow {
  /** Moles in mmol. */
  mmol: number | null
  massMg: number | null
  volumeMl: number | null
  equiv: number | null
  /** What the product would weigh if everything reacted, in mg. */
  theoreticalMg: number | null
  /** Isolated over theoretical, as a percentage. */
  yieldPercent: number | null
}

const positive = (v: number | null | undefined): v is number => {
  const parsed = z.number().safeParse(v)

  return parsed.success && parsed.data > 0
}

/**
 * The row the others are measured against: the one chosen, else the first
 * reactant that has an amount (it is the one that was measured out), else the
 * first reactant.
 */
export function limitingRow(payload: ReactionPayload): ReactionRow | null {
  const reactants = payload.rows.filter((r) => r.role === 'reactant')

  return (
    reactants.find((r) => r.id === payload.limitingId) ??
    reactants.find((r) => ownMmol(r) !== null) ??
    reactants.at(0) ??
    null
  )
}

/** The moles a row stands for from what was typed for it alone, in mmol. */
function ownMmol(row: ReactionRow): number | null {
  if (!positive(row.mw)) return null

  if (positive(row.massMg)) return row.massMg / row.mw

  if (positive(row.volumeMl) && positive(row.density)) {
    return (row.volumeMl * row.density * 1000) / row.mw
  }

  if (positive(row.volumeMl) && positive(row.concentration)) {
    return row.volumeMl * row.concentration
  }

  return null
}

/**
 * Fills in what can be worked out. The limiting reactant is measured out
 * directly; every other reactant or reagent follows from its equivalents, or, if
 * only an amount was typed, its equivalents follow from that amount. Products
 * show what the limiting reactant could make and, once a mass is typed, the
 * yield. Anything that cannot be worked out is null, never a guess.
 */
export function computeReactionTable(
  payload: ReactionPayload,
): Map<string, ComputedRow> {
  const out = new Map<string, ComputedRow>()
  const limiting = limitingRow(payload)
  const limitingMmol = limiting ? ownMmol(limiting) : null

  for (const row of payload.rows) {
    const computed: ComputedRow = {
      mmol: null,
      massMg: null,
      volumeMl: null,
      equiv: null,
      theoreticalMg: null,
      yieldPercent: null,
    }

    const mw = positive(row.mw) ? row.mw : null

    if (row.role === 'product') {
      const coefficient = positive(row.equiv) ? row.equiv : 1

      if (limitingMmol !== null) {
        computed.mmol = limitingMmol * coefficient
        computed.equiv = coefficient

        if (mw !== null) computed.theoreticalMg = computed.mmol * mw
      }

      computed.massMg = positive(row.massMg) ? row.massMg : null

      if (computed.massMg !== null && mw !== null) {
        const isolatedMmol = computed.massMg / mw
        computed.yieldPercent =
          computed.mmol !== null && computed.mmol > 0
            ? (isolatedMmol / computed.mmol) * 100
            : null
      }
    } else if (row.role === 'solvent') {
      computed.volumeMl = positive(row.volumeMl) ? row.volumeMl : null
      computed.massMg = positive(row.massMg) ? row.massMg : null
    } else if (row.id === limiting?.id) {
      computed.equiv = 1
      computed.mmol = limitingMmol
      computed.massMg = positive(row.massMg)
        ? row.massMg
        : limitingMmol !== null && mw !== null
          ? limitingMmol * mw
          : null
      computed.volumeMl = volumeFor(row, computed.mmol, computed.massMg)
    } else {
      let mmol: number | null = null

      if (positive(row.equiv) && limitingMmol !== null) {
        mmol = row.equiv * limitingMmol
      } else {
        mmol = ownMmol(row)

        if (mmol !== null && limitingMmol !== null) {
          computed.equiv = mmol / limitingMmol
        }
      }

      computed.mmol = mmol

      if (positive(row.equiv)) computed.equiv = row.equiv
      computed.massMg = positive(row.massMg)
        ? row.massMg
        : mmol !== null && mw !== null
          ? mmol * mw
          : null
      computed.volumeMl = volumeFor(row, mmol, computed.massMg)
    }

    out.set(row.id, computed)
  }

  return out
}

function volumeFor(
  row: ReactionRow,
  mmol: number | null,
  massMg: number | null,
): number | null {
  if (positive(row.volumeMl)) return row.volumeMl

  if (mmol !== null && positive(row.concentration))
    return mmol / row.concentration

  if (massMg !== null && positive(row.density))
    return massMg / 1000 / row.density

  return null
}

export type AmountField =
  'mw' | 'equiv' | 'massMg' | 'volumeMl' | 'density' | 'concentration'

/**
 * What a typed amount means for the row. Amounts and equivalents pull against
 * each other on a reagent (typing one clears the other, so the table never holds
 * two answers); the limiting reactant and the products keep what was typed.
 */
export function amountPatch(
  row: ReactionRow,
  field: AmountField,
  value: number | null,
): Partial<ReactionRow> {
  const patch: Partial<ReactionRow> = { [field]: value }
  const follows = row.role === 'reactant' || row.role === 'reagent'

  if (follows && value !== null) {
    if (field === 'equiv') {
      patch.massMg = null
      patch.volumeMl = null
    } else if (field === 'massMg' || field === 'volumeMl') {
      patch.equiv = null
    }
  }

  return patch
}

// ---------------------------------------------------------------------------
// Keeping the table in step with the drawing.
// ---------------------------------------------------------------------------

/** A molecule found in the drawing, as the table needs to know it. */
export interface DrawnComponent {
  role: Exclude<ReactionRole, 'solvent'>
  structureCode: string
  formula: string
  mw: number | null
}

let counter = 0

/** A row id that is unique within a notebook block. */
export function newRowId(): string {
  counter += 1

  return `r${Date.now().toString(36)}${counter.toString(36)}`
}

/**
 * Rebuilds the rows after the drawing changed. A row whose molecule is still
 * drawn keeps what was typed for it (a reagent that moves to the arrow keeps its
 * role only if it is still a reagent; its amounts stay either way). Molecules
 * that are new get a row; molecules that were taken away lose theirs. Rows added
 * by hand are left alone.
 */
export function syncRowsWithDrawing(
  rows: readonly ReactionRow[],
  drawn: readonly DrawnComponent[],
): ReactionRow[] {
  const byCode = new Map<string, ReactionRow[]>()

  for (const row of rows) {
    if (!row.structureCode) continue
    byCode.set(row.structureCode, [
      ...(byCode.get(row.structureCode) ?? []),
      row,
    ])
  }

  const used = new Set<string>()

  const fromDrawing: ReactionRow[] = drawn.map((component) => {
    const existing = (byCode.get(component.structureCode) ?? []).find(
      (row) => !used.has(row.id),
    )

    if (existing) {
      used.add(existing.id)

      return {
        ...existing,
        role: component.role,
        formula: component.formula,
        mw: component.mw,
      }
    }

    return {
      id: newRowId(),
      role: component.role,
      name: '',
      formula: component.formula,
      mw: component.mw,
      structureCode: component.structureCode,
    }
  })

  const byHand = rows.filter((row) => !row.structureCode)
  const order = (role: ReactionRole) => REACTION_ROLES.indexOf(role)

  return [...fromDrawing, ...byHand].sort(
    (a, b) => order(a.role) - order(b.role),
  )
}

// ---------------------------------------------------------------------------
// Display.
// ---------------------------------------------------------------------------

/** A number for the table: enough digits to be useful, no trailing noise. */
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '—'
  const abs = Math.abs(value)
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 10 ? 2 : 3

  return Number(value.toFixed(digits)).toLocaleString('en-GB', {
    maximumFractionDigits: digits,
  })
}
