/**
 * The notebook block registry: what the rest of the app reads to know which
 * block types exist and how to treat each one.
 *
 * Every block is declared once, in `./declarations`: its payload validator, its
 * editable flag, starting payload, summary and insert-menu entry. This module
 * derives the type union, the allow-list, the insert catalogue and the
 * descriptors from that list, so the pieces cannot drift apart.
 *
 * Adding a type means one entry in `./declarations`, its validator in
 * `./validators`, and one migration widening `chk_blocks_type`. The registry
 * parity test checks the declarations against the latest widening migration.
 *
 * Boundaries kept deliberately:
 *
 * - **Editor and preview bodies stay in their modules.** They are 3,000 and
 *   1,900 lines of feature components. The declaration records whether an
 *   editor exists (`editable`) and the editor switch consults that flag.
 * - **`sheet_shared` is not a block type.** It is an insertion affordance that
 *   resolves to a `sheet` block bound to an existing instance, so it lives in
 *   the catalogue and not in `BLOCK_TYPES`.
 */

import { t } from '#/copy'
import type { IconName } from '#/components/icons'
import {
  BLOCK_DECLARATIONS,
  CALCULATOR_PICKER_TYPE,
  EXTRA_PICKER_OPTIONS,
} from './declarations'
import type { BlockDeclaration, BlockGroupId } from './declarations'

export { CALCULATOR_PICKER_TYPE }
export type { BlockGroupId }

/**
 * Every block type the database constraint `chk_blocks_type` allows, derived
 * from the declarations.
 */
export type BlockType = (typeof BLOCK_DECLARATIONS)[number]['type']

/**
 * The allow-list, in the order `chk_blocks_type` names them. A type not in this
 * list is rejected at the boundary as `unsupported_block_type`.
 */
export const BLOCK_TYPES: readonly BlockType[] = BLOCK_DECLARATIONS.map(
  (declaration) => declaration.type,
)

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
  { id: 'structure', label: t('notebook.blockRegistry.label') },
  { id: 'writing', label: t('notebook.blockRegistry.writingLabel') },
  { id: 'evidence', label: t('notebook.blockRegistry.filesAndFiguresLabel') },
  // R5-NOTE-02: the design's "Sign and attach" group; the two block kinds it
  // names exist in no other group.
  { id: 'sign', label: t('notebook.blockRegistry.signAndAttachLabel') },
]

export const BLOCK_PICKER_OPTIONS: readonly BlockPickerOption[] = [
  ...BLOCK_DECLARATIONS.flatMap((declaration: BlockDeclaration) =>
    declaration.picker
      ? [{ ...declaration.picker, type: declaration.type }]
      : [],
  ),
  ...EXTRA_PICKER_OPTIONS,
]
  .sort((a, b) => a.order - b.order)
  .map(({ type, label, description, icon, group, aliases }) => ({
    type,
    label,
    description,
    icon,
    group,
    aliases,
  }))

// ---------------------------------------------------------------------------
// Per-type descriptor.
// ---------------------------------------------------------------------------

export type BlockDescriptor = Omit<BlockDeclaration, 'type' | 'picker'>

export const BLOCK_DESCRIPTORS = Object.fromEntries(
  BLOCK_DECLARATIONS.map((declaration) => [declaration.type, declaration]),
) as unknown as Record<BlockType, BlockDescriptor>

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
