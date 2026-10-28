/**
 * Settings → Storage and labels: the label templates a lab prints with. A
 * template is the size of the label, the kind of code on it and which facts it
 * carries. What a printed 2D code resolves to is fixed (see `labels.ts`); a
 * template cannot change it.
 */
import type { DataClient } from '#/lib/data-client'
import { labelTemplateFromRow } from '#/lib/labels'
import type { BarcodeType, LabelTemplate } from '#/lib/labels'

export const labelTemplateKeys = {
  all: (workspaceId: string) => ['label-templates', workspaceId] as const,
}

/** The kinds of record a label can be made for. */
export const LABEL_RECORD_KINDS = [{ key: 'sample', label: 'Samples' }] as const

export const LABEL_SIZE_PRESETS = [
  { label: '50 × 25 mm', widthMm: 50, heightMm: 25 },
  { label: '25 × 13 mm (cryo tube)', widthMm: 25, heightMm: 13 },
  { label: '76 × 25 mm', widthMm: 76, heightMm: 25 },
  { label: '100 × 50 mm', widthMm: 100, heightMm: 50 },
] as const

export async function fetchLabelTemplates(
  client: DataClient,
): Promise<LabelTemplate[]> {
  const rows = await client.list<Record<string, unknown>>(
    'label_templates',
    '?select=*&order=name.asc&limit=500',
  )
  return rows.map(labelTemplateFromRow)
}

/** Templates a person can print with: not archived, the default first. */
export function activeLabelTemplates(
  templates: readonly LabelTemplate[],
  recordKind: string,
): LabelTemplate[] {
  return templates
    .filter((t) => t.recordKind === recordKind && !t.archivedAt)
    .sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        a.name.localeCompare(b.name),
    )
}

export interface LabelTemplateInput {
  name: string
  recordKind: string
  widthMm: string
  heightMm: string
  barcodeType: BarcodeType
  showLot: boolean
  showSampleType: boolean
  showCondition: boolean
  showUseBy: boolean
  isDefault: boolean
}

export const EMPTY_LABEL_INPUT: LabelTemplateInput = {
  name: '',
  recordKind: 'sample',
  widthMm: '50',
  heightMm: '25',
  barcodeType: 'qr',
  showLot: true,
  showSampleType: false,
  showCondition: true,
  showUseBy: true,
  isDefault: false,
}

export function inputFromTemplate(template: LabelTemplate): LabelTemplateInput {
  return {
    name: template.name,
    recordKind: template.recordKind,
    widthMm: String(template.widthMm),
    heightMm: String(template.heightMm),
    barcodeType: template.barcodeType,
    showLot: template.showLot,
    showSampleType: template.showSampleType,
    showCondition: template.showCondition,
    showUseBy: template.showUseBy,
    isDefault: template.isDefault,
  }
}

/** The first thing wrong with a template form, in the words a person would use. */
export function validateLabelInput(input: LabelTemplateInput): string | null {
  if (!input.name.trim()) return 'Give the template a name.'
  if (input.name.trim().length > 120)
    return 'Use 120 characters or fewer for the name.'
  for (const [label, raw] of [
    ['width', input.widthMm],
    ['height', input.heightMm],
  ] as const) {
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 10 || n > 200)
      return `The ${label} is a whole number of millimetres between 10 and 200.`
  }
  return null
}

export async function saveLabelTemplate(
  client: DataClient,
  workspaceId: string,
  id: string | null,
  input: LabelTemplateInput,
): Promise<LabelTemplate> {
  const row = await client.rpc<Record<string, unknown>>('save_label_template', {
    p_workspace_id: workspaceId,
    p_id: id,
    p_name: input.name.trim(),
    p_record_kind: input.recordKind,
    p_width_mm: Number(input.widthMm),
    p_height_mm: Number(input.heightMm),
    p_barcode_type: input.barcodeType,
    p_show_lot: input.showLot,
    p_show_sample_type: input.showSampleType,
    p_show_condition: input.showCondition,
    p_show_use_by: input.showUseBy,
    p_is_default: input.isDefault,
  })
  return labelTemplateFromRow(row)
}

export async function setLabelTemplateArchived(
  client: DataClient,
  templateId: string,
  archived: boolean,
): Promise<void> {
  await client.rpc('set_label_template_archived', {
    p_template_id: templateId,
    p_archived: archived,
  })
}
