/**
 * Block declarations: one entry per stored block type, holding everything the
 * app knows about it in one place: its payload validator, whether the editor
 * has a case for it, its starting payload, its one-line summary and, when the
 * insert menus offer it, its label, description, icon, group and search words.
 *
 * The type union, the allow-list, the insert catalogue, the descriptors and
 * the payload validation in `./index` are all derived from this list by
 * `./registry`. Adding a type means one entry here, its validator in
 * `./validators`, and one migration widening `chk_blocks_type` (the registry
 * parity test checks the list against the latest widening). Editor and preview
 * bodies stay in their components: an entry records only whether an editor
 * exists (`editable`), and the editor switch consults that flag.
 *
 * Entries are in the order `chk_blocks_type` names them. `picker.order` is the
 * order the insert menus show them in, which follows the notebook design.
 */
import { t } from '#/copy'
import type { IconName } from '#/components/icons'
import {
  EMPTY_RICH_TEXT_PAYLOAD,
  isRichTextPayload,
  richTextToPlainText,
} from './rich-text'
import { EMPTY_CONCLUSION_PAYLOAD } from '../conclusion-block'
import { EMPTY_REACTION_PAYLOAD, EMPTY_STRUCTURE_PAYLOAD } from '../chemistry'
import { EMPTY_SEQUENCE_PAYLOAD } from '../sequence-block'
import {
  EMPTY_CORRECTIVE_ACTIONS_PAYLOAD,
  EMPTY_SIGNATURE_REQUEST_PAYLOAD,
} from '../notebook-action-blocks'
import {
  validateAnalysis,
  validateCallout,
  validateChart,
  validateChecklist,
  validateCodeCell,
  validateConclusion,
  validateDatasetImport,
  validateFile,
  validateGate,
  validateLinkedRecord,
  validateMaterials,
  validateMetric,
  validatePipelineOutput,
  validatePlateMap,
  validatePluginBlock,
  validateProcedureStep,
  validateProtocolReference,
  validateReaction,
  validateRichText,
  validateSequence,
  validateSheet,
  validateStructure,
  validateTable,
  validateCorrectiveActions,
  validateSignatureRequest,
} from './validators'
import type { FieldErrors } from './validators'

export type BlockGroupId = 'structure' | 'writing' | 'evidence' | 'sign'

/** The picker entry that opens the bench calculator rather than adding a block. */
export const CALCULATOR_PICKER_TYPE = 'calculator'

/** How a block is offered in the insert menus (`+` and `/`). */
export interface BlockPickerEntry {
  /** Position in the menus, lowest first. */
  order: number
  label: string
  description: string
  icon: IconName
  group: BlockGroupId
  aliases: readonly string[]
}

export interface BlockDeclaration {
  /** Stored in `blocks.type`. */
  type: string
  /** Omitted for a type the menus do not offer. */
  picker?: BlockPickerEntry
  /**
   * Whether the editor switch, `BlockEditorBody`, has a case for this type.
   * `callout`, `table` and `metric` are stored, validated and rendered but
   * cannot be edited. `sheet` is rendered by the document through
   * `NotebookSheetBlock`, which owns the instance embed and the
   * frozen-evidence panel, so it never reaches the editor switch.
   */
  editable: boolean
  /** A minimal, valid payload so a new block enters editing focus cleanly. */
  defaultPayload: () => Record<string, unknown>
  /**
   * One-line readable preview, used by the conflict banner. Absent where the
   * reader should see the payload as JSON.
   */
  summary?: (payload: Record<string, unknown>) => string
  /** The payload contract: field-level errors, none when the payload is valid. */
  validate: (payload: unknown) => FieldErrors
}

/** Declares a block and keeps its literal type for the `BlockType` union. */
export function defineBlocks<const T extends readonly BlockDeclaration[]>(
  declarations: T,
): T {
  return declarations
}

export const BLOCK_DECLARATIONS = defineBlocks([
  {
    type: 'rich_text',
    picker: {
      order: 7,
      label: t('notebook.blockRegistry.textLabel'),
      description: t('notebook.blockRegistry.paragraphDescription'),
      icon: 'edit',
      group: 'writing',
      aliases: ['heading', 'paragraph', 'note', 'prose'],
    },
    editable: true,
    defaultPayload: () => ({ ...EMPTY_RICH_TEXT_PAYLOAD }),
    summary: (payload) =>
      isRichTextPayload(payload)
        ? richTextToPlainText(payload) || '(empty)'
        : '(empty)',
    validate: validateRichText,
  },
  {
    type: 'checklist',
    picker: {
      order: 8,
      label: t('notebook.blockRegistry.checklistLabel'),
      description: t('notebook.blockRegistry.aListOfCheckableDescription'),
      icon: 'check',
      group: 'writing',
      aliases: ['todo', 'tasks'],
    },
    editable: true,
    defaultPayload: () => ({ items: [{ text: '', checked: false }] }),
    summary: (payload) => {
      const items = Array.isArray(payload.items) ? payload.items : []
      if (items.length === 0) return t('notebook.blockRegistry.noItems')
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
    validate: validateChecklist,
  },
  {
    type: 'linked_record',
    picker: {
      order: 2,
      label: t('notebook.blockRegistry.recordReferenceLabel'),
      description: t('notebook.blockRegistry.sampleMaterialDatasetDescription'),
      icon: 'link',
      group: 'structure',
      aliases: ['dataset', 'record', 'sample', 'material', 'link'],
    },
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
    validate: validateLinkedRecord,
  },
  {
    type: 'callout',
    picker: {
      order: 9,
      label: t('notebook.blockRegistry.calloutLabel'),
      description: t('notebook.blockRegistry.aNoteTheReaderDescription'),
      icon: 'info',
      group: 'writing',
      aliases: ['note', 'warning', 'banner', 'aside', 'info'],
    },
    // A4: editable since the callout editor landed. The static `table` block
    // is still read-only on purpose — see the note in `block-editor.tsx`.
    editable: true,
    defaultPayload: () => ({}),
    validate: validateCallout,
  },
  {
    type: 'table',
    editable: false,
    defaultPayload: () => ({}),
    validate: validateTable,
  },
  {
    type: 'sheet',
    picker: {
      order: 1,
      label: t('notebook.blockRegistry.sheetLabel'),
      description: t(
        'notebook.blockRegistry.spreadsheetWithDatasetSourcesDescription',
      ),
      icon: 'table',
      group: 'structure',
      aliases: ['table', 'grid', 'spreadsheet'],
    },
    editable: false,
    defaultPayload: () => ({}),
    validate: validateSheet,
  },
  {
    type: 'chart',
    editable: true,
    // SCI-004: a chart starts as an empty draft `{}` (valid) so the editor
    // opens immediately; the user picks a dataset, fields and chart type.
    defaultPayload: () => ({}),
    validate: validateChart,
  },
  {
    type: 'analysis',
    picker: {
      order: 12,
      label: t('notebook.blockRegistry.chartOrAnalysisLabel'),
      description: t('notebook.blockRegistry.aSavedChartADescription'),
      icon: 'chart',
      group: 'evidence',
      aliases: ['chart', 'plot', 'graph', 'statistics', 'regression', 'fit'],
    },
    editable: true,
    defaultPayload: () => ({}),
    summary: (payload) =>
      `${payload.title || t('notebook.blockRegistry.analysis')}${payload.frozen ? t('notebook.blockRegistry.frozenSuffix') : ''}`,
    validate: validateAnalysis,
  },
  {
    type: 'plate_map',
    picker: {
      order: 13,
      label: t('notebook.blockRegistry.plateMapLabel'),
      description: t('notebook.blockRegistry.a96WellPlateDescription'),
      icon: 'table',
      group: 'evidence',
      aliases: ['plate', 'wells'],
    },
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
      return t('notebook.blockRegistry.plateMapSummary', {
        title: title || t('notebook.blockRegistry.plateMapLabel'),
        count: Array.isArray(wells) ? wells.length : 0,
      })
    },
    validate: validatePlateMap,
  },
  {
    type: 'file',
    picker: {
      order: 11,
      label: t('notebook.blockRegistry.fileOrImageLabel'),
      description: t('notebook.blockRegistry.attachAFileWithDescription'),
      icon: 'download',
      group: 'evidence',
      aliases: ['image', 'photo', 'pdf', 'attachment'],
    },
    editable: true,
    defaultPayload: () => ({}),
    validate: validateFile,
  },
  {
    type: 'metric',
    picker: {
      order: 14,
      label: t('notebook.blockRegistry.metricLabel'),
      description: t('notebook.blockRegistry.aSingleHeadlineNumberDescription'),
      icon: 'chart',
      group: 'evidence',
      aliases: ['kpi', 'number', 'stat', 'measurement'],
    },
    editable: true,
    defaultPayload: () => ({}),
    validate: validateMetric,
  },
  {
    type: 'procedure_step',
    editable: true,
    defaultPayload: () => ({}),
    validate: validateProcedureStep,
  },
  {
    type: 'protocol_reference',
    picker: {
      order: 4,
      label: t('notebook.blockRegistry.protocolLabel'),
      description: t('notebook.blockRegistry.pinAnExactProtocolDescription'),
      icon: 'flask',
      group: 'structure',
      aliases: ['sop', 'method'],
    },
    editable: true,
    defaultPayload: () => ({}),
    validate: validateProtocolReference,
  },
  {
    type: 'materials',
    picker: {
      order: 5,
      label: t('notebook.blockRegistry.materialsLabel'),
      description: t(
        'notebook.blockRegistry.linkedSamplesAndMaterialsDescription',
      ),
      icon: 'box',
      group: 'structure',
      aliases: ['samples', 'materials', 'inventory'],
    },
    editable: true,
    defaultPayload: () => ({ items: [] }),
    validate: validateMaterials,
  },
  {
    type: 'pipeline_output',
    picker: {
      order: 20,
      label: t('notebook.blockRegistry.pipelineOutputLabel'),
      description: t('notebook.blockRegistry.referenceAPipelineRunDescription'),
      icon: 'pipeline',
      group: 'evidence',
      aliases: ['pipeline', 'automation', 'run'],
    },
    editable: true,
    defaultPayload: () => ({}),
    summary: (payload) =>
      `${t('notebook.blockRegistry.pipelineOutputLabel')}${
        payload.runId
          ? t('notebook.blockRegistry.runId', {
              runId: String(payload.runId).slice(0, 8),
            })
          : ''
      }`,
    validate: validatePipelineOutput,
  },
  {
    type: 'signature_request',
    picker: {
      order: 21,
      label: t('notebook.blockRegistry.signatureRequestLabel'),
      description: t('notebook.blockRegistry.askSomeoneToSignDescription'),
      icon: 'lock',
      group: 'sign',
      aliases: ['sign', 'signature', 'attest', 'approve', 'witness'],
    },
    editable: true,
    // R5-NOTE-02: a signature request starts with no signer, so the block
    // renders the honest missing-reference state until one is chosen.
    defaultPayload: () => ({ ...EMPTY_SIGNATURE_REQUEST_PAYLOAD }),
    validate: validateSignatureRequest,
  },
  {
    type: 'corrective_actions',
    picker: {
      order: 22,
      label: t('notebook.blockRegistry.correctiveActionsLabel'),
      description: t('notebook.blockRegistry.actionsWithAnOwnerDescription'),
      icon: 'check',
      group: 'sign',
      aliases: ['capa', 'actions', 'corrective', 'finding', 'deviation'],
    },
    editable: true,
    // R5-NOTE-02: a CAPA list starts empty; the block says so rather than
    // showing a header with nothing under it.
    defaultPayload: () => ({ ...EMPTY_CORRECTIVE_ACTIONS_PAYLOAD }),
    validate: validateCorrectiveActions,
  },
  {
    type: 'conclusion',
    picker: {
      order: 10,
      label: t('notebook.blockRegistry.conclusionLabel'),
      description: t(
        'notebook.blockRegistry.whatTheExperimentFoundDescription',
      ),
      icon: 'check',
      group: 'writing',
      aliases: ['result', 'finding', 'outcome', 'summary', 'verdict'],
    },
    editable: true,
    defaultPayload: () => ({ ...EMPTY_CONCLUSION_PAYLOAD }),
    summary: (payload) =>
      typeof payload.text === 'string' && payload.text ? payload.text : '',
    validate: validateConclusion,
  },
  {
    type: 'dataset_import',
    picker: {
      order: 0,
      label: t('notebook.blockRegistry.importDataLabel'),
      description: t('notebook.blockRegistry.description'),
      icon: 'upload',
      group: 'structure',
      aliases: ['import', 'csv', 'upload'],
    },
    editable: true,
    defaultPayload: () => ({}),
    validate: validateDatasetImport,
  },
  {
    type: 'structure',
    picker: {
      order: 16,
      label: t('notebook.blockRegistry.structureLabel'),
      description: t('notebook.blockRegistry.structureDescription'),
      icon: 'flask',
      group: 'evidence',
      aliases: [
        'molecule',
        'chemical',
        'compound',
        'drawing',
        'smiles',
        'chemistry',
      ],
    },
    editable: true,
    defaultPayload: () => ({ ...EMPTY_STRUCTURE_PAYLOAD }),
    summary: (payload) =>
      [
        typeof payload.title === 'string' && payload.title
          ? payload.title
          : typeof payload.name === 'string'
            ? payload.name
            : '',
        typeof payload.formula === 'string' ? payload.formula : '',
      ]
        .filter(Boolean)
        .join(' · ') || t('notebook.blockRegistry.structureLabel'),
    validate: validateStructure,
  },
  {
    type: 'reaction',
    picker: {
      order: 17,
      label: t('notebook.blockRegistry.reactionLabel'),
      description: t('notebook.blockRegistry.reactionDescription'),
      icon: 'flask',
      group: 'evidence',
      aliases: [
        'synthesis',
        'scheme',
        'equivalents',
        'yield',
        'stoichiometry',
        'chemistry',
      ],
    },
    editable: true,
    defaultPayload: () => ({ ...EMPTY_REACTION_PAYLOAD, rows: [] }),
    summary: (payload) =>
      t('notebook.blockRegistry.reactionSummary', {
        title:
          typeof payload.title === 'string' && payload.title
            ? payload.title
            : t('notebook.blockRegistry.reactionLabel'),
        count: Array.isArray(payload.rows) ? payload.rows.length : 0,
      }),
    validate: validateReaction,
  },
  {
    type: 'code_cell',
    picker: {
      order: 18,
      label: t('notebook.blockRegistry.codeCellLabel'),
      description: t('notebook.blockRegistry.codeCellDescription'),
      icon: 'code',
      group: 'evidence',
      aliases: [
        'python',
        'sql',
        'code',
        'script',
        'notebook',
        'analysis',
        'query',
      ],
    },
    editable: true,
    defaultPayload: () => ({ language: 'python', source: '', inputs: [] }),
    summary: (payload) =>
      `${t('notebook.blockRegistry.codeCellLabel')}${
        typeof payload.language === 'string' ? ` (${payload.language})` : ''
      }`,
    validate: validateCodeCell,
  },
  {
    type: 'gate',
    picker: {
      order: 6,
      label: t('notebook.gates.blockLabel'),
      description: t('notebook.gates.blockDescription'),
      icon: 'lock',
      group: 'structure',
      aliases: ['gate', 'hold', 'wait', 'lock', 'condition', 'opens when'],
    },
    // Rendered by the gate bar and changed through the gate dialog, not by the
    // editor switch. It has no useful empty draft: the database refuses a gate
    // without conditions, so one is only inserted once the dialog has some.
    editable: false,
    defaultPayload: () => ({ mode: 'warn', conditions: [] }),
    summary: (payload) =>
      typeof payload.label === 'string' && payload.label
        ? payload.label
        : t('notebook.gates.blockLabel'),
    validate: validateGate,
  },
  {
    type: 'sequence',
    picker: {
      order: 19,
      label: t('notebook.blockRegistry.sequenceLabel'),
      description: t('notebook.blockRegistry.sequenceDescription'),
      icon: 'dna',
      group: 'evidence',
      aliases: [
        'dna',
        'plasmid',
        'primer',
        'digest',
        'restriction',
        'gibson',
        'golden gate',
        'cloning',
        'sanger',
        'genbank',
        'fasta',
        'construct',
        'gel',
      ],
    },
    editable: true,
    defaultPayload: () => ({ ...EMPTY_SEQUENCE_PAYLOAD, features: [] }),
    summary: (payload) =>
      t('notebook.blockRegistry.sequenceSummary', {
        title:
          typeof payload.title === 'string' && payload.title
            ? payload.title
            : typeof payload.name === 'string' && payload.name
              ? payload.name
              : t('notebook.blockRegistry.sequenceLabel'),
        length:
          typeof payload.residues === 'string' ? payload.residues.length : 0,
      }),
    validate: validateSequence,
  },
  {
    // A block a plugin declares. Not in the fixed insert menus: the menus list
    // each enabled plugin's blocks from the plugin points (see
    // `usePluginBlockOptions`).
    type: 'plugin',
    editable: true,
    defaultPayload: () => ({}),
    summary: (payload) =>
      typeof payload.block === 'string' ? payload.block : 'Plugin block',
    validate: validatePluginBlock,
  },
])

/**
 * Menu entries that are not stored block types. `sheet_shared` resolves to a
 * `sheet` block bound to an existing instance; the calculator opens the bench
 * calculator and inserts the answer as a metric block.
 */
export const EXTRA_PICKER_OPTIONS: readonly (BlockPickerEntry & {
  type: string
})[] = [
  {
    type: 'sheet_shared',
    order: 3,
    label: t('notebook.blockRegistry.linkExistingSheetLabel'),
    description: t('notebook.blockRegistry.showASheetThatDescription'),
    icon: 'link',
    group: 'structure',
    aliases: ['embed', 'reuse'],
  },
  {
    type: CALCULATOR_PICKER_TYPE,
    order: 15,
    label: t('calculators.picker.label'),
    description: t('calculators.picker.description'),
    icon: 'calculator',
    group: 'evidence',
    aliases: ['molarity', 'dilution', 'c1v1', 'convert', 'units', 'calculate'],
  },
]
