/**
 * REUSE-03: deliberate safe upgrades for reusable structures.
 *
 * Consumers hold governed pins naming the exact published versions they were
 * composed from (a Notebook's `source_notebook_template_version_id`, a Sheet
 * Instance's `source_definition_version_id`, and the per-placement
 * `definitionVersionId` pins in the REUSE-02 instantiation receipt). This
 * module reads those pins without starting an upgrade flow:
 *
 * - Availability: compare a stored pin against the published lineage and
 *   report `upgrade-available` only when a newer published version exists.
 *   Never auto-applies, never badges as an error, silent when pinned is
 *   current or unresolvable.
 * - Impact: summarise a preview (added/removed/changed parameters,
 *   placement/binding changes, effect on local overrides) for display before
 *   adopting. Previews are re-validated through the existing upgrade
 *   validators, so an unresolvable diff fails closed by throwing.
 * - Adoption: validate an explicit adopt request (preview-first, target pin
 *   must match the previewed target, one decision per conflict) and return
 *   the old/new version pair as dependency/version evidence. Applying
 *   re-pins governed values to the target while local values and overrides
 *   stay untouched per the preview's `preserved` manifest; the apply RPCs
 *   persist that pair as provenance.
 */
import {
  parseNotebookTemplateUpgradeDecisions,
  parseNotebookTemplateUpgradePreviewFromWire,
} from './notebook-template-upgrade'
import type {
  NotebookUpgradeDecision,
  NotebookUpgradePreview,
} from './notebook-template-upgrade'
import {
  parseSheetDefinitionUpgradeDecisions,
  parseSheetDefinitionUpgradePreview,
} from './sheet-definition-upgrade'
import type {
  SheetDefinitionUpgradeDecision,
  SheetDefinitionUpgradePreview,
} from './sheet-definition-upgrade'

// ---------------------------------------------------------------------------
// Availability: stored pin vs published lineage
// ---------------------------------------------------------------------------

export interface ReusePinnedVersion {
  id: string
  version: number
}

export interface ReuseVersionRef {
  id: string
  version: number
}

export interface ReusePublishedVersion {
  id: string
  version: number
  lifecycle: string
}

export type ReuseUpgradeStatus = 'current' | 'upgrade-available' | 'unknown'

export interface ReuseUpgradeAvailability {
  status: ReuseUpgradeStatus
  /** Newest published version, for the explicit adopt target. Null unless an upgrade is available. */
  latestVersion: { id: string; version: number } | null
}

function newestVersion(
  versions: ReadonlyArray<ReuseVersionRef>,
): { id: string; version: number } | null {
  let latest: { id: string; version: number } | null = null
  for (const candidate of versions) {
    if (!Number.isInteger(candidate.version) || candidate.version <= 0) continue
    if (!latest || candidate.version > latest.version)
      latest = { id: candidate.id, version: candidate.version }
  }
  return latest
}

/**
 * Compare a stored governed pin against its resolved published lineage.
 * Returns `upgrade-available` only when a newer published version exists;
 * `current` when the pin matches (or leads) the lineage; `unknown` when the
 * pin or lineage cannot be resolved — callers render nothing in both silent
 * cases.
 */
export function reuseUpgradeAvailability(
  pinned: ReusePinnedVersion | null | undefined,
  published: ReadonlyArray<ReuseVersionRef>,
): ReuseUpgradeAvailability {
  if (!pinned || !Number.isInteger(pinned.version) || pinned.version <= 0)
    return { status: 'unknown', latestVersion: null }
  const latest = newestVersion(published)
  if (!latest) return { status: 'unknown', latestVersion: null }
  if (latest.version <= pinned.version)
    return { status: 'current', latestVersion: null }
  return { status: 'upgrade-available', latestVersion: latest }
}

function publishedRefs(
  versions: ReadonlyArray<ReusePublishedVersion>,
): ReuseVersionRef[] {
  return versions
    .filter((version) => version.lifecycle === 'published')
    .map((version) => ({ id: version.id, version: version.version }))
}

/** Notebook consumer: pinned Template Version vs the Template lineage. */
export function notebookTemplateUpgradeAvailability(
  pinned: ReusePinnedVersion | null | undefined,
  versions: ReadonlyArray<ReusePublishedVersion>,
): ReuseUpgradeAvailability {
  return reuseUpgradeAvailability(pinned, publishedRefs(versions))
}

/**
 * Sheet consumer: pinned Definition Version vs the Definition lineage. A
 * Notebook composition part reuses the same check per placement pin — each
 * part's `definitionVersionId` is compared against its own Definition's
 * published lineage.
 */
export function sheetDefinitionUpgradeAvailability(
  pinned: ReusePinnedVersion | null | undefined,
  versions: ReadonlyArray<ReusePublishedVersion>,
): ReuseUpgradeAvailability {
  return reuseUpgradeAvailability(pinned, publishedRefs(versions))
}

// ---------------------------------------------------------------------------
// Impact: human-readable preview summaries (fail-closed on unresolvable diff)
// ---------------------------------------------------------------------------

export interface ReuseUpgradeImpactSummary {
  title: string
  /** What changed between pinned and latest, grouped by object family. */
  lines: string[]
  /** Effect on local working state and overrides. */
  localEffects: string[]
  automaticCount: number
  conflictCount: number
}

function pluralise(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`
}

type FamilyCounts = { added: number; removed: number; changed: number }

function familyLine(label: string, counts: FamilyCounts): string | null {
  const parts: string[] = []
  if (counts.added > 0) parts.push(`${counts.added} added`)
  if (counts.removed > 0) parts.push(`${counts.removed} removed`)
  if (counts.changed > 0) parts.push(`${counts.changed} changed`)
  if (parts.length === 0) return null
  return `${label}: ${parts.join(', ')}`
}

const SHEET_AUTOMATIC_FAMILY: Record<string, string> = {
  'column-added': 'Columns',
  'column-label-renamed': 'Columns',
  'parameter-added': 'Parameters',
  'parameter-label-renamed': 'Parameters',
  'binding-added': 'Bindings',
  'join-added': 'Joins',
  'calculation-added': 'Calculations',
  'write-back-added': 'Write-back rules',
  'action-added': 'Actions',
}

function sheetConflictFamily(
  kind: string,
): { label: string; delta: 'removed' | 'changed' } | null {
  if (kind === 'parameter-required')
    return { label: 'Parameters', delta: 'changed' }
  if (kind === 'column-incompatible')
    return { label: 'Columns', delta: 'changed' }
  if (
    kind === 'row-identity-changed' ||
    kind === 'local-identity-collision' ||
    kind === 'instance-calculation-collision'
  )
    return null
  const dash = kind.lastIndexOf('-')
  if (dash <= 0) return null
  const family = kind.slice(0, dash)
  const delta = kind.slice(dash + 1)
  if (delta !== 'removed' && delta !== 'changed') return null
  switch (family) {
    case 'column':
      return { label: 'Columns', delta }
    case 'parameter':
      return { label: 'Parameters', delta }
    case 'binding':
      return { label: 'Bindings', delta }
    case 'join':
      return { label: 'Joins', delta }
    case 'calculation':
      return { label: 'Calculations', delta }
    case 'write-back':
      return { label: 'Write-back rules', delta }
    case 'action':
      return { label: 'Actions', delta }
    default:
      return null
  }
}

function sheetLocalTouchCount(preview: SheetDefinitionUpgradePreview): number {
  return preview.conflicts.filter((conflict) => {
    const references = conflict.instanceReferences
    return (
      references.localField ||
      references.localValueCount > 0 ||
      references.calculationIds.length > 0 ||
      references.calculationOverride ||
      references.presentation
    )
  }).length
}

/**
 * Summarise a Sheet Definition upgrade preview for display. Re-validates the
 * preview through the existing upgrade validator first: unknown shapes throw
 * instead of rendering a partial diff.
 */
export function summarizeSheetDefinitionUpgradeImpact(
  preview: unknown,
): ReuseUpgradeImpactSummary {
  const parsed = parseSheetDefinitionUpgradePreview(preview)
  const families: Record<string, FamilyCounts> = {}
  const renamed: string[] = []
  for (const change of parsed.automaticChanges) {
    if (change.kind.endsWith('-label-renamed')) {
      renamed.push(
        change.kind.startsWith('parameter-') ? 'parameter' : 'column',
      )
      continue
    }
    const label = SHEET_AUTOMATIC_FAMILY[change.kind]
    if (!label) throw new Error(`Unresolvable upgrade change "${change.kind}".`)
    const counts = (families[label] ??= { added: 0, removed: 0, changed: 0 })
    counts.added += 1
  }

  let requiredParameters = 0
  const structuralConflicts: string[] = []
  for (const conflict of parsed.conflicts) {
    if (conflict.kind === 'parameter-required') {
      requiredParameters += 1
      continue
    }
    if (
      conflict.kind === 'row-identity-changed' ||
      conflict.kind === 'local-identity-collision' ||
      conflict.kind === 'instance-calculation-collision'
    ) {
      structuralConflicts.push(conflict.kind)
      continue
    }
    const family = sheetConflictFamily(conflict.kind)
    if (!family)
      throw new Error(`Unresolvable upgrade conflict "${conflict.kind}".`)
    const counts = (families[family.label] ??= {
      added: 0,
      removed: 0,
      changed: 0,
    })
    counts[family.delta] += 1
  }

  const order = [
    'Parameters',
    'Columns',
    'Bindings',
    'Joins',
    'Calculations',
    'Write-back rules',
    'Actions',
  ]
  const lines: string[] = []
  for (const label of order) {
    const counts = families[label] as FamilyCounts | undefined
    const line = counts ? familyLine(label, counts) : null
    if (line) lines.push(line)
  }
  if (requiredParameters > 0)
    lines.push(
      `Parameters: ${pluralise(requiredParameters, 'newly required parameter')}`,
    )
  if (renamed.length > 0)
    lines.push(
      `${pluralise(renamed.length, 'label rename')} applied automatically`,
    )
  for (const kind of structuralConflicts) {
    if (kind === 'row-identity-changed')
      lines.push('Row identity changed: needs an explicit decision')
    else if (kind === 'local-identity-collision')
      lines.push(
        'Local field collides with a target object: needs an explicit decision',
      )
    else
      lines.push(
        'Instance calculation collides with a target object: needs an explicit decision',
      )
  }
  if (lines.length === 0)
    lines.push('No changes between pinned and latest versions.')

  const localEffects: string[] = []
  if (parsed.preserved.localFieldIds.length > 0)
    localEffects.push(
      `${pluralise(parsed.preserved.localFieldIds.length, 'local field')} preserved`,
    )
  if (parsed.preserved.localValueRowCount > 0)
    localEffects.push(
      `${pluralise(parsed.preserved.localValueRowCount, 'local value row')} preserved`,
    )
  if (parsed.preserved.calculationOverrideIds.length > 0)
    localEffects.push(
      `${pluralise(parsed.preserved.calculationOverrideIds.length, 'calculation override')} preserved`,
    )
  if (parsed.preserved.instanceCalculationIds.length > 0)
    localEffects.push(
      `${pluralise(parsed.preserved.instanceCalculationIds.length, 'instance calculation')} preserved`,
    )
  if (localEffects.length === 0)
    localEffects.push('No local fields, values, or overrides on this instance.')
  localEffects.push(
    'Presentation stays with the instance; bindings revalidated against the target.',
  )
  const touched = sheetLocalTouchCount(parsed)
  if (touched > 0)
    localEffects.push(
      `${pluralise(touched, 'conflict')} reference${touched === 1 ? 's' : ''} local state — check each decision.`,
    )

  return {
    title: `Definition v${parsed.source.version} → v${parsed.target.version}`,
    lines,
    localEffects,
    automaticCount: parsed.automaticChanges.length,
    conflictCount: parsed.conflicts.length,
  }
}

/**
 * Summarise a Notebook Template upgrade preview for display, including the
 * per-part Definition impact nested in each conflicting placement.
 * Re-validates through the existing upgrade validator: unknown shapes throw.
 */
export function summarizeNotebookTemplateUpgradeImpact(
  preview: unknown,
): ReuseUpgradeImpactSummary {
  const parsed: NotebookUpgradePreview =
    parseNotebookTemplateUpgradePreviewFromWire(preview)
  const lines: string[] = []
  const localEffects: string[] = []

  let added = 0
  let removed = 0
  let repinned = 0
  for (const change of parsed.automatic) {
    if (change.kind === 'placement-added') added += 1
    else if (change.kind === 'placement-removed') removed += 1
    else repinned += 1
  }
  if (added > 0 || removed > 0) {
    const parts: string[] = []
    if (added > 0) parts.push(`${added} added`)
    if (removed > 0) parts.push(`${removed} removed`)
    lines.push(`Placements: ${parts.join(', ')}`)
  }
  if (repinned > 0)
    lines.push(
      `${pluralise(repinned, 'part')} re-pin${repinned === 1 ? 's' : ''} cleanly to a newer Definition version`,
    )

  let unresolved = 0
  for (const conflict of parsed.conflicts) {
    if (conflict.kind === 'sheet-placement-unresolved') {
      unresolved += 1
      lines.push(
        `Placement ${conflict.placementId ?? conflict.id} has no matching working state: keep or resolve first`,
      )
      continue
    }
    if (!conflict.instancePreview)
      throw new Error(`Unresolvable upgrade conflict "${conflict.kind}".`)
    const nested = summarizeSheetDefinitionUpgradeImpact(
      conflict.instancePreview,
    )
    const part = conflict.placementId ?? conflict.id
    for (const line of nested.lines) lines.push(`Part ${part}: ${line}`)
    for (const effect of nested.localEffects) {
      const scoped = `Part ${part}: ${effect}`
      if (!localEffects.includes(scoped)) localEffects.push(scoped)
    }
  }
  if (unresolved === 0 && parsed.conflicts.length > 0 && lines.length === 0)
    lines.push(
      `${pluralise(parsed.conflicts.length, 'part')} need an explicit decision`,
    )
  if (lines.length === 0)
    lines.push('No changes between pinned and latest versions.')
  if (localEffects.length === 0)
    localEffects.push(
      'Local values and overrides stay untouched; only governed pins move.',
    )

  return {
    title: 'Template upgrade impact',
    lines,
    localEffects,
    automaticCount: parsed.automatic.length,
    conflictCount: parsed.conflicts.length,
  }
}

// ---------------------------------------------------------------------------
// Adoption: explicit, preview-first, recorded with old/new versions
// ---------------------------------------------------------------------------

export interface SheetDefinitionUpgradeAdoption {
  sourceDefinitionVersionId: string
  targetDefinitionVersionId: string
  decisions: SheetDefinitionUpgradeDecision[]
}

export interface NotebookTemplateUpgradeAdoption {
  sourceVersionId: string
  targetVersionId: string
  decisions: NotebookUpgradeDecision[]
}

/**
 * Validate an explicit Sheet Definition adoption before applying. The preview
 * must name the requested target (stale previews fail closed) and every
 * conflict needs exactly one decision — mirroring the apply RPC. Returns the
 * old/new version pair for dependency/version evidence; applying re-pins
 * governed values to the target while `preserved` local state stays with
 * the instance.
 */
export function buildSheetDefinitionUpgradeAdoption(input: {
  preview: unknown
  targetVersionId: string
  decisions: unknown
}): SheetDefinitionUpgradeAdoption {
  const parsed = parseSheetDefinitionUpgradePreview(input.preview)
  if (parsed.target.versionId !== input.targetVersionId)
    throw new Error('Upgrade preview is stale: re-preview before applying.')
  const decisions = parseSheetDefinitionUpgradeDecisions(input.decisions)
  if (decisions.length !== parsed.conflicts.length)
    throw new Error('Every upgrade conflict requires exactly one decision.')
  return {
    sourceDefinitionVersionId: parsed.source.versionId,
    targetDefinitionVersionId: parsed.target.versionId,
    decisions,
  }
}

/**
 * Validate an explicit Notebook Template adoption before applying. Same
 * preview-first contract as the Sheet adoption: stale previews fail closed,
 * every placement conflict needs exactly one decision. Returns the old/new
 * Template Version pair for dependency/version evidence.
 */
export function buildNotebookTemplateUpgradeAdoption(input: {
  preview: unknown
  targetVersionId: string
  decisions: unknown
}): NotebookTemplateUpgradeAdoption {
  const parsed: NotebookUpgradePreview =
    parseNotebookTemplateUpgradePreviewFromWire(input.preview)
  if (parsed.targetVersionId !== input.targetVersionId)
    throw new Error('Upgrade preview is stale: re-preview before applying.')
  const decisions = parseNotebookTemplateUpgradeDecisions(input.decisions)
  if (decisions.length !== parsed.conflicts.length)
    throw new Error('Every upgrade conflict requires exactly one decision.')
  return {
    sourceVersionId: parsed.sourceVersionId,
    targetVersionId: parsed.targetVersionId,
    decisions,
  }
}
