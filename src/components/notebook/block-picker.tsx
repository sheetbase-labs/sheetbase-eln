import type { IconName } from '#/components/v3/icons'

/**
 * The block catalogue: the editable block types with familiar labels (Text,
 * Sheet, Record reference) rather than internal codes.
 *
 * EXP-04.3 — the labels, descriptions and order of the entries the Insert
 * block menu in the notebook design names (`canvas/NbEditing.dc.html`) come
 * from that design: Sheet, Chart, Record reference, Text, File or image,
 * each with its canvas description verbatim.
 *
 * The design's menu is a flat seven-entry mock of the menu at one cursor
 * position, so the catalogue keeps only the entries that are real block
 * types and keeps the Roadmap-2 grouping both insert surfaces share
 * (Sheets and references → Writing → Files and figures), led by the group
 * the design highlights first (Sheet). The design's other two entries are
 * not block types and live inside a block instead: "Heading" is the
 * rich-text heading mark and "Formula" is a Sheet column (ƒx).
 *
 * The insertion UI is the command-palette `AddBlockMenu` (`+`) and the slash
 * menu (`/`); this module owns the option list they share.
 */

export interface BlockPickerOption {
  type: string
  label: string
  description: string
  icon: IconName
  group: 'structure' | 'writing' | 'evidence' | 'sign'
  aliases: readonly string[]
}

/** Group order follows the design, which opens on Sheet. */
export const BLOCK_PICKER_GROUPS = [
  { id: 'structure', label: 'Sheets and references' },
  { id: 'writing', label: 'Writing' },
  { id: 'evidence', label: 'Files and figures' },
  // R5-NOTE-02: the design's "Sign and attach" group; the two block kinds it
  // names exist in no other group.
  { id: 'sign', label: 'Sign and attach' },
] as const

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
