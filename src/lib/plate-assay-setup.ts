/**
 * An assay setup that remembers itself: which columns are the controls, how the
 * wells are normalised, what counts as a hit, which curve is fitted and how good
 * a plate has to be. It is kept on the plate design (the assay design plates
 * already point at), so the second plate of an assay is read, analysed and shown
 * the way the first one was, with nothing typed again.
 *
 * Reads go straight to the table under row-level security. Saving goes through
 * `save_plate_design_assay_setup`, which keeps the rules (who may write, what the
 * setup may hold) and sends `plate_design.assay_setup_saved`.
 */
import { z } from 'zod'

import type { DataClient } from '#/lib/data-client'
import { defaultAssayConfig, normaliseAssayConfig } from '#/lib/plate-assay'
import type {
  AssayMethod,
  AssayWell,
  PlateAssayConfig,
} from '#/lib/plate-assay'
import { createPlateDesign } from '#/lib/plate-designer'
import type { PlateFormat } from '#/lib/plate-map'

export const assayDesignKeys = {
  all: ['assay-designs'] as const,
}

export interface AssaySetup {
  config: PlateAssayConfig
  /** Columns that hold the negative control, as the person writes them ("1", "11-12"). */
  negativeColumns: string
  /** Columns that hold the positive control. */
  positiveColumns: string
}

export interface AssayDesign {
  id: string
  name: string
  setup: AssaySetup | null
}

interface AssayDesignWire {
  id: string
  name: string
  assay_setup: unknown
}

const setupWire = z.object({
  config: z.json(),
  negativeColumns: z.string().catch(''),
  positiveColumns: z.string().catch(''),
})

/** A stored setup read back, or null when the design has none (or it is unreadable). */
export function readAssaySetup<Value>(raw: Value): AssaySetup | null {
  const parsed = setupWire.safeParse(raw)

  if (!parsed.success) return null

  return {
    config: normaliseAssayConfig(parsed.data.config),
    negativeColumns: parsed.data.negativeColumns,
    positiveColumns: parsed.data.positiveColumns,
  }
}

/** The designs a plate can follow, with the setup each one remembers. */
export async function fetchAssayDesigns(
  client: DataClient,
): Promise<AssayDesign[]> {
  const rows = await client.list<AssayDesignWire>(
    'plate_designs',
    '?select=id,name,assay_setup&status=neq.archived&order=name.asc&limit=500',
  )

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    setup: readAssaySetup(row.assay_setup),
  }))
}

/** Remember a setup on a design, and point a plate run at it when one is named. */
export async function saveAssaySetup(
  client: DataClient,
  input: { designId: string; setup: AssaySetup; runId?: string | null },
): Promise<void> {
  await client.rpc<unknown>('save_plate_design_assay_setup', {
    p_design_id: input.designId,
    p_setup: {
      config: input.setup.config,
      negativeColumns: input.setup.negativeColumns,
      positiveColumns: input.setup.positiveColumns,
    },
    p_plate_run_id: input.runId ?? null,
  })
}

/** Make a design for an assay that has none yet, and remember the setup on it. */
export async function createAssayDesign(
  client: DataClient,
  input: {
    workspaceId: string
    name: string
    format: PlateFormat
    setup: AssaySetup
    runId?: string | null
  },
): Promise<string> {
  const design = await createPlateDesign(client, {
    workspaceId: input.workspaceId,
    name: input.name.trim(),
    format: input.format,
  })

  await saveAssaySetup(client, {
    designId: design.id,
    setup: input.setup,
    runId: input.runId,
  })

  return design.id
}

/** Column numbers in the shortest way a person would write them: "1, 3, 11-12". */
export function writeColumnList(columns: readonly number[]): string {
  const sorted = [...new Set(columns)].sort((a, b) => a - b)
  const parts: string[] = []

  for (let i = 0; i < sorted.length;) {
    let end = i

    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++
    parts.push(end > i ? `${sorted[i]}-${sorted[end]}` : String(sorted[i]))
    i = end + 1
  }

  return parts.join(', ')
}

/** The columns that hold each control, as the person writes them. */
export interface ControlColumnLists {
  negative: string
  positive: string
}

/**
 * The control columns a run's layout already has: a column counts when every
 * well in it is that control. A run read with a layout rather than control
 * columns still gives the next plate its control columns this way.
 */
export function controlColumnsOfWells(
  wells: readonly AssayWell[],
): ControlColumnLists {
  const byColumn = new Map<number, AssayWell[]>()

  for (const well of wells) {
    const column = Number(/\d+$/.exec(well.wellCode)?.[0])

    if (!Number.isFinite(column)) continue
    byColumn.set(column, [...(byColumn.get(column) ?? []), well])
  }

  const wholly = (role: AssayWell['role']): number[] =>
    [...byColumn.entries()].flatMap(([column, inColumn]) =>
      inColumn.every((well) => well.role === role) ? [column] : [],
    )

  return {
    negative: writeColumnList(wholly('negative_control')),
    positive: writeColumnList(wholly('positive_control')),
  }
}

/** Whether two configs analyse a plate the same way. */
export function sameAssayConfig(
  a: PlateAssayConfig,
  b: PlateAssayConfig,
): boolean {
  return (
    JSON.stringify(normaliseAssayConfig(a)) ===
    JSON.stringify(normaliseAssayConfig(b))
  )
}

/** What the dialog asks to be remembered once the run is saved. */
export type RememberRequest =
  | { kind: 'design'; designId: string; name: string }
  | { kind: 'new'; name: string }
  | null

export interface AssayChoiceInput {
  designs: readonly AssayDesign[]
  /** The design the person picked, or null while they have not. */
  chosen: string | null
  /** The design the experiment's last plate followed, or ''. */
  lastDesignId: string
  negativeEdit: string | null
  positiveEdit: string | null
  rememberChoice: boolean | null
  newName: string
  /** Control columns worked out from the plate itself, used when nothing else gives them. */
  guess: { negative: string; positive: string } | null
  /** How the person chose to read this plate, over what the design remembers. */
  methodEdit?: AssayMethod | null
  /** The dilution the person typed, over what the design remembers. */
  dilutionEdit?: number | null
}

/**
 * What the chosen design gives a plate, and what it offers to remember: its
 * controls and settings, whether this plate's can be kept for the next one, and
 * the request that does it. An experiment that already has plates starts on the
 * design its last plate followed.
 */
export function resolveAssayChoice(input: AssayChoiceInput) {
  const designId = input.chosen ?? input.lastDesignId
  const design = input.designs.find((d) => d.id === designId) ?? null
  const setup = design?.setup ?? null
  const guess = setup === null ? input.guess : null

  const negative =
    input.negativeEdit ?? setup?.negativeColumns ?? guess?.negative ?? ''

  const positive =
    input.positiveEdit ?? setup?.positiveColumns ?? guess?.positive ?? ''

  const guessed =
    guess !== null && input.negativeEdit === null && input.positiveEdit === null

  const remembered: PlateAssayConfig = setup?.config ?? defaultAssayConfig()
  const method = input.methodEdit ?? remembered.method
  const dilutionFactor = input.dilutionEdit ?? remembered.dilutionFactor
  const config: PlateAssayConfig = { ...remembered, method, dilutionFactor }

  const settingsChanged =
    method !== remembered.method || dilutionFactor !== remembered.dilutionFactor

  // A plate read by a standard curve has no control columns, but it still has a
  // setup worth remembering: how it is read and how far it is diluted.
  const hasControls =
    negative.trim() !== '' || positive.trim() !== '' || method === 'quantify'

  const controlsChanged = setup
    ? negative !== setup.negativeColumns ||
      positive !== setup.positiveColumns ||
      settingsChanged
    : false

  /** A design with no setup yet, or with different controls, can take this plate's. */
  const canRememberOnDesign =
    design !== null && hasControls && (setup === null || controlsChanged)

  const rememberOnDesign = input.rememberChoice ?? setup === null

  const request: RememberRequest = canRememberOnDesign
    ? rememberOnDesign
      ? { kind: 'design', designId: design.id, name: design.name }
      : null
    : design === null && hasControls && input.newName.trim() !== ''
      ? { kind: 'new', name: input.newName.trim() }
      : null

  return {
    designId,
    design,
    setup,
    config,
    method,
    dilutionFactor,
    negative,
    positive,
    /** The columns were worked out from the plate, not typed or remembered. */
    guessed,
    hasControls,
    takenFromLastPlate:
      input.chosen === null && input.lastDesignId !== '' && design !== null,
    canRememberOnDesign,
    rememberOnDesign,
    request,
  }
}
