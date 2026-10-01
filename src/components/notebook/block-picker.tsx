import type { IconName } from '#/components/v3/icons'

/**
 * The block catalogue: the editable block types with familiar labels (Text,
 * Checklist, Linked record) rather than internal codes. The insertion UI is
 * the command-palette `AddBlockMenu` and the slash menu; this module owns the
 * option list they share.
 */

export interface BlockPickerOption {
  type: string
  label: string
  description: string
  icon: IconName
  group: 'writing' | 'structure' | 'evidence'
  aliases: readonly string[]
}

export const BLOCK_PICKER_GROUPS = [
  { id: 'writing', label: 'Writing' },
  { id: 'structure', label: 'Sheets and references' },
  { id: 'evidence', label: 'Files and figures' },
] as const

export const BLOCK_PICKER_OPTIONS: readonly BlockPickerOption[] = [
  {
    type: 'rich_text',
    label: 'Text',
    description: 'Headings, paragraphs, and prose lists.',
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
    type: 'linked_record',
    label: 'Linked record',
    description:
      'A reference to another experiment, Dataset, sample or reagent.',
    icon: 'link',
    group: 'structure',
    aliases: ['dataset', 'record', 'sample', 'reagent', 'link'],
  },
  {
    type: 'sheet',
    label: 'Sheet',
    description: 'Start a new Sheet on this Notebook.',
    icon: 'table',
    group: 'structure',
    aliases: ['table', 'grid', 'spreadsheet'],
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
    description: 'Linked samples and reagents with quantities and units.',
    icon: 'box',
    group: 'structure',
    aliases: ['samples', 'reagents', 'inventory'],
  },
  {
    type: 'file',
    label: 'File',
    description: 'Attach a file with provenance and lifecycle states.',
    icon: 'download',
    group: 'evidence',
    aliases: ['image', 'photo', 'pdf', 'attachment'],
  },
  {
    type: 'chart',
    label: 'Chart',
    description:
      'A line, scatter or bar chart from a saved dataset, with a live or frozen snapshot.',
    icon: 'chart',
    group: 'evidence',
    aliases: ['plot', 'graph'],
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
]
