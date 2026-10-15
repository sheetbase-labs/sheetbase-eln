/**
 * The notebook block registry — the single declaration point for a block type.
 *
 * Before this module, one block type was declared in eight places: the
 * `BlockType` union and allow-list in `./index`, the validator map in the same
 * file, the `chk_blocks_type` migration, the insert-menu catalogue in
 * `block-picker.tsx`, the `defaultPayloadFor` switch in
 * `#/lib/notebook-mutations`, the `EDITABLE_TYPES` and `WIDE_BLOCK_TYPES` sets
 * in `notebook-document.tsx`, the `BlockEditorBody` switch and the conflict
 * summary in `block-editor.tsx`, and the `renderPayload` switch in
 * `block-preview.tsx`.
 *
 * Adding a type now means: one descriptor here, one validator in `./index`, one
 * migration widening `chk_blocks_type`. Three places, each for a different
 * reason — the descriptor is the product shape, the validator is the payload
 * contract, the migration is the database constraint.
 *
 * Boundaries kept deliberately:
 *
 * - **Validators stay in `./index`.** They are the application-boundary payload
 *   contract, shared with server paths, so they are not UI-shaped data.
 * - **Editor and preview bodies stay in their modules.** They are 3,000 and
 *   1,900 lines of feature components. The descriptor records whether an editor
 *   exists (`editable`) and the editor switch consults that flag, so the two
 *   cannot drift without failing the registry parity test.
 * - **`sheet_shared` is not a block type.** It is an insertion affordance that
 *   resolves to a `sheet` block bound to an existing instance, so it lives in
 *   the catalogue and not in `BLOCK_TYPES`.
 *
 * This module is a pure re-point: the union, allow-list, catalogue, defaults,
 * summaries are moved here verbatim from the sites above, so the
 * consolidation itself changes no behaviour. Improvements to any of those —
 * richer summaries, default payloads for the types that have none — are
 * separate product changes.
 */

import type { IconName } from '#/components/v3/icons'
import {
  EMPTY_RICH_TEXT_PAYLOAD,
  isRichTextPayload,
  richTextToPlainText,
} from './rich-text'
import {
  EMPTY_CORRECTIVE_ACTIONS_PAYLOAD,
  EMPTY_SIGNATURE_REQUEST_PAYLOAD,
} from '../notebook-action-blocks'

/**
 * Every block type the database constraint `chk_blocks_type` allows. The parity
 * test in `registry.test.ts` checks this list against the latest widening
 * migration.
 */
export type BlockType =
  | 'rich_text'
  | 'checklist'
  | 'linked_record'
  | 'callout'
  | 'table'
  | 'sheet'
  | 'chart'
  | 'analysis'
  | 'plate_map'
  | 'file'
  | 'metric'
  | 'procedure_step'
  | 'protocol_reference'
  | 'materials'
  | 'pipeline_output'
  | 'signature_request'
  | 'corrective_actions'

/**
 * The allow-list, in the order `chk_blocks_type` names them. A type not in this
 * list is rejected at the boundary as `unsupported_block_type`.
 */
export const BLOCK_TYPES: readonly BlockType[] = [
  'rich_text',
  'checklist',
  'linked_record',
  'callout',
  'table',
  'sheet',
  'chart',
  'analysis',
  'plate_map',
  'file',
  'metric',
  'procedure_step',
  'protocol_reference',
  'materials',
  'pipeline_output',
  'signature_request',
  'corrective_actions',
]

/** Membership index for the allow-list; each key is a stored block type. */
const BLOCK_TYPE_INDEX: Record<string, true> = Object.fromEntries(
  BLOCK_TYPES.map((type) => [type, true as const]),
)

/** True when the string is a block type this build knows how to store. */
export function isBlockType(value: string): value is BlockType {
  return Object.hasOwn(BLOCK_TYPE_INDEX, value)
}

// ---------------------------------------------------------------------------
// Insert catalogue. The insertion UI is the command-palette AddBlockMenu (`+`)
// and the slash menu (`/`); both read this list, so an entry is declared once.
// ---------------------------------------------------------------------------

export type BlockGroupId = 'structure' | 'writing' | 'evidence' | 'sign'

export interface BlockPickerOption {
  /**
   * The insertion kind. Usually a block type; `sheet_shared` is the one
   * affordance that is not, and resolves to a `sheet` block bound to an
   * existing instance.
   */
  type: string
  label: string
  description: string
  icon: IconName
  group: BlockGroupId
  aliases: readonly string[]
}

/**
 * The block catalogue: the editable block types with familiar labels (Text,
 * Sheet, Record reference) rather than internal codes.
 *
 * EXP-04.3 — the labels, descriptions and order of the entries the Insert block
 * menu in the notebook design names (`canvas/NbEditing.dc.html`) come from that
 * design: Sheet, Chart, Record reference, Text, File or image, each with its
 * canvas description verbatim.
 *
 * The design's menu is a flat seven-entry mock of the menu at one cursor
 * position, so the catalogue keeps only the entries that are real block types
 * and keeps the Roadmap-2 grouping both insert surfaces share (Sheets and
 * references → Writing → Files and figures), led by the group the design
 * highlights first (Sheet). The design's other two entries are not block types
 * and live inside a block instead: "Heading" is the rich-text heading mark and
 * "Formula" is a Sheet column (ƒx).
 *
 * The insertion UI is the command-palette `AddBlockMenu` (`+`) and the slash
 * menu (`/`); this registry owns the option list they share. Group order follows
 * the design, which opens on Sheet.
 */
export const BLOCK_PICKER_GROUPS: readonly {
  id: BlockGroupId
  label: string
}[] = [
  { id: 'structure', label: 'Sheets and references' },
  { id: 'writing', label: 'Writing' },
  { id: 'evidence', label: 'Files and figures' },
  // R5-NOTE-02: the design's "Sign and attach" group; the two block kinds it
  // names exist in no other group.
  { id: 'sign', label: 'Sign and attach' },
]

export const BLOCK_PICKER_OPTIONS: readonly BlockPickerOption[] = [
  {
    type: 'sheet',
    label: 'Sheet',
    description: 'Grid backed by a model',
    icon: 'table',
    group: 'structure',
    aliases: ['table', 'grid', 'spreadsheet'],
  },
  {
    type: 'linked_record',
    label: 'Record reference',
    description: 'Sample, material, dataset…',
    icon: 'link',
    group: 'structure',
    aliases: ['dataset', 'record', 'sample', 'material', 'link'],
  },
  {
    type: 'sheet_shared',
    label: 'Link existing Sheet',
    description:
      'Show a Sheet that already exists. Edits stay shared with every Notebook that uses it.',
    icon: 'link',
    group: 'structure',
    aliases: ['embed', 'reuse'],
  },
  {
    type: 'protocol_reference',
    label: 'Protocol',
    description: 'Pin an exact protocol version and its procedure.',
    icon: 'flask',
    group: 'structure',
    aliases: ['sop', 'method'],
  },
  {
    type: 'materials',
    label: 'Materials',
    description: 'Linked samples and materials with quantities and units.',
    icon: 'box',
    group: 'structure',
    aliases: ['samples', 'materials', 'inventory'],
  },
  {
    type: 'rich_text',
    label: 'Text',
    description: 'Paragraph',
    icon: 'edit',
    group: 'writing',
    aliases: ['heading', 'paragraph', 'note', 'prose'],
  },
  {
    type: 'checklist',
    label: 'Checklist',
    description: 'A list of checkable items.',
    icon: 'check',
    group: 'writing',
    aliases: ['todo', 'tasks'],
  },
  {
    type: 'callout',
    label: 'Callout',
    description: 'A note the reader must not miss, in one of four tones.',
    icon: 'info',
    group: 'writing',
    aliases: ['note', 'warning', 'banner', 'aside', 'info'],
  },
  {
    type: 'chart',
    label: 'Chart',
    description: 'From a sheet or dataset',
    icon: 'chart',
    group: 'evidence',
    aliases: ['plot', 'graph'],
  },
  {
    type: 'file',
    label: 'File or image',
    description: 'Attach a file with provenance and lifecycle states.',
    icon: 'download',
    group: 'evidence',
    aliases: ['image', 'photo', 'pdf', 'attachment'],
  },
  {
    type: 'analysis',
    label: 'Analysis',
    description:
      'A saved analysis — grouped statistics or a regression fit — run against live dataset rows, freezable as evidence.',
    icon: 'code',
    group: 'evidence',
    aliases: ['statistics', 'regression', 'fit'],
  },
  {
    type: 'plate_map',
    label: 'Plate map',
    description:
      'A 96-well plate layout with sample assignments, controls, replicates and volumes.',
    icon: 'table',
    group: 'evidence',
    aliases: ['plate', 'wells'],
  },
  {
    type: 'metric',
    label: 'Metric',
    description: 'A single headline number with its unit and provenance.',
    icon: 'chart',
    group: 'evidence',
    aliases: ['kpi', 'number', 'stat', 'measurement'],
  },
  {
    type: 'pipeline_output',
    label: 'Pipeline output',
    description:
      'Reference a Pipeline run and pin the Dataset Version it produced into the notebook.',
    icon: 'pipeline',
    group: 'evidence',
    aliases: ['pipeline', 'automation', 'run'],
  },
  {
    type: 'signature_request',
    label: 'Signature request',
    description:
      'Ask someone to sign this record with a meaning. The request is raised when the Notebook is submitted.',
    icon: 'lock',
    group: 'sign',
    aliases: ['sign', 'signature', 'attest', 'approve', 'witness'],
  },
  {
    type: 'corrective_actions',
    label: 'Corrective actions',
    description:
      'Actions with an owner, due date and status, for the corrections a finding needs.',
    icon: 'check',
    group: 'sign',
    aliases: ['capa', 'actions', 'corrective', 'finding', 'deviation'],
  },
]

// ---------------------------------------------------------------------------
// Per-type descriptor.
// ---------------------------------------------------------------------------

export interface BlockDescriptor {
  /**
   * Whether the editor switch, `BlockEditorBody`, has a case for this type.
   * `callout`, `table` and `metric` are stored, validated and rendered but
   * cannot be edited. `sheet` is rendered by the document through
   * `NotebookSheetBlock`, which owns the instance embed and the
   * frozen-evidence panel, so it never reaches the editor switch.
   *
   * A4 owns closing the gap: either an editor for a type, or the type stops
   * being offered as an insertion.
   */
  editable: boolean
  /**
   * A minimal, valid payload so a new block enters editing focus cleanly.
   * Types that returned `{}` from the old `defaultPayloadFor` switch still
   * return `{}`.
   */
  defaultPayload: () => Record<string, unknown>
  /**
   * One-line readable preview, used by the conflict banner so the reader can
   * comprehend the server version without switching tabs. Absent where the old
   * switch had no case, in which case `summarizeBlockPayload` dumps the JSON as
   * it always did.
   */
  summary?: (payload: Record<string, unknown>) => string
}

export const BLOCK_DESCRIPTORS: Record<BlockType, BlockDescriptor> = {
  rich_text: {
    editable: true,
    defaultPayload: () => ({ ...EMPTY_RICH_TEXT_PAYLOAD }),
    summary: (payload) =>
      isRichTextPayload(payload)
        ? richTextToPlainText(payload) || '(empty)'
        : '(empty)',
  },
  checklist: {
    editable: true,
    defaultPayload: () => ({ items: [{ text: '', checked: false }] }),
    summary: (payload) => {
      const items = Array.isArray(payload.items) ? payload.items : []
      if (items.length === 0) return '(no items)'
      return items
        .map((item) => {
          const checked =
            typeof item === 'object' &&
            item !== null &&
            'checked' in item &&
            item.checked === true
          const text =
            typeof item === 'object' &&
            item !== null &&
            'text' in item &&
            typeof item.text === 'string'
              ? item.text
              : ''
          return `[${checked ? 'x' : ' '}] ${text}`
        })
        .join('\n')
    },
  },
  linked_record: {
    editable: true,
    defaultPayload: () => ({
      targetKind: 'experiment',
      targetIdentifier: '',
      linkType: 'general',
      label: '',
    }),
    summary: (payload) =>
      `${payload.linkType ?? 'general'}: ${payload.targetKind ?? ''} ${
        payload.targetIdentifier ?? ''
      }${payload.label ? ` — ${payload.label}` : ''}`,
  },
  callout: {
    // A4: editable since the callout editor landed. The static `table` block
    // is still read-only on purpose — see the note in `block-editor.tsx`.
    editable: true,
    defaultPayload: () => ({}),
  },
  table: { editable: false, defaultPayload: () => ({}) },
  sheet: { editable: false, defaultPayload: () => ({}) },
  chart: {
    editable: true,
    // SCI-004: a chart starts as an empty draft `{}` (valid) so the editor
    // opens immediately; the user picks a dataset, fields and chart type.
    defaultPayload: () => ({}),
  },
  analysis: {
    editable: true,
    defaultPayload: () => ({}),
    summary: (payload) =>
      `${payload.title || 'Analysis'}${payload.frozen ? ' (frozen)' : ''}`,
  },
  plate_map: {
    editable: true,
    // SCI-005: a plate map starts as an empty draft `{}` (valid) so the editor
    // opens immediately; the user sets dimensions and assigns wells.
    defaultPayload: () => ({}),
    summary: (payload) => {
      const title = typeof payload.title === 'string' ? payload.title : ''
      const spec = 'spec' in payload ? payload.spec : undefined
      const wells =
        typeof spec === 'object' && spec !== null && 'wells' in spec
          ? spec.wells
          : undefined
      return `${title || 'Plate map'} — ${
        Array.isArray(wells) ? wells.length : 0
      } well(s)`
    },
  },
  file: { editable: true, defaultPayload: () => ({}) },
  metric: { editable: true, defaultPayload: () => ({}) },
  procedure_step: {
    editable: true,
    defaultPayload: () => ({}),
  },
  protocol_reference: {
    editable: true,
    defaultPayload: () => ({}),
  },
  materials: {
    editable: true,
    defaultPayload: () => ({ items: [] }),
  },
  pipeline_output: {
    editable: true,
    defaultPayload: () => ({}),
    summary: (payload) =>
      `Pipeline output${
        payload.runId ? ` — run ${String(payload.runId).slice(0, 8)}` : ''
      }`,
  },
  signature_request: {
    editable: true,
    // R5-NOTE-02: a signature request starts with no signer, so the block
    // renders the honest missing-reference state until one is chosen.
    defaultPayload: () => ({ ...EMPTY_SIGNATURE_REQUEST_PAYLOAD }),
  },
  corrective_actions: {
    editable: true,
    // R5-NOTE-02: a CAPA list starts empty; the block says so rather than
    // showing a header with nothing under it.
    defaultPayload: () => ({ ...EMPTY_CORRECTIVE_ACTIONS_PAYLOAD }),
  },
}

/** The descriptor for a type, or `undefined` for a type this build rejects. */
export function blockDescriptor(type: string): BlockDescriptor | undefined {
  return isBlockType(type) ? BLOCK_DESCRIPTORS[type] : undefined
}

/** True when the editor switch has a case for this type. */
export function isEditableBlockType(type: string): boolean {
  return blockDescriptor(type)?.editable === true
}

/** The types the notebook edits in place, in allow-list order. */
export function editableBlockTypes(): readonly BlockType[] {
  return BLOCK_TYPES.filter((type) => BLOCK_DESCRIPTORS[type].editable)
}

/**
 * Default payloads for the block types the insert menu offers. Each starts
 * minimal and valid so the new block enters editing focus immediately without
 * surfacing a validation error first.
 */
export function defaultPayloadFor(type: string): Record<string, unknown> {
  return blockDescriptor(type)?.defaultPayload() ?? {}
}

/** Readable one-line payload preview for the conflict banner. */
export function summarizeBlockPayload(
  type: string,
  payload: Record<string, unknown>,
): string {
  const summary = blockDescriptor(type)?.summary
  return summary ? summary(payload) : JSON.stringify(payload, null, 2)
}
