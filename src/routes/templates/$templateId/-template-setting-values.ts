/**
 * The plain values behind a template's settings: a setting's kind of value in
 * words, and the sheet settings a template setting can feed.
 */
import type { useSheetDefinitions } from '#/components/templates/templates-data'
import type { NotebookTemplatePlacement } from '#/lib/notebook-template'
import type { Parameter, ParameterValueType } from '#/lib/parameter'
import { t } from '#/copy'

const VALUE_TYPE_COPY = {
  text: 'library.templates.notebook.valueText',
  integer: 'library.templates.notebook.valueWholeNumber',
  decimal: 'library.templates.notebook.valueNumber',
  boolean: 'library.templates.notebook.valueYesNo',
  date: 'library.templates.notebook.valueDate',
  timestamp: 'library.templates.notebook.valueDateTime',
  category: 'library.templates.notebook.valueChoice',
  reference: 'library.templates.notebook.valueRecord',
} as const satisfies Record<ParameterValueType, string>

/** A setting's kind of value, in words. */
export function valueTypeLabel(valueType: ParameterValueType): string {
  return t(VALUE_TYPE_COPY[valueType])
}

/** A scalar setting of a sheet a placement pins, which a template setting can feed. */
export interface SettingTarget {
  placementId: string
  sheetTitle: string
  parameter: Parameter
}

/** The scalar settings of every sheet the template places, for a template
 * setting to feed. */
export function sheetSettingTargets(
  placements: NotebookTemplatePlacement[],
  versionsById: ReturnType<typeof useSheetDefinitions>['versionsById'],
): SettingTarget[] {
  return placements.flatMap((placement) => {
    if (placement.kind !== 'sheet') return []

    const definition = versionsById.get(placement.definitionVersionId)

    return (definition?.configuration.parameters ?? [])
      .filter((parameter) => parameter.type.kind === 'scalar')
      .map((parameter) => ({
        placementId: placement.id,
        sheetTitle: placement.title ?? t('library.templates.overview.sheet'),
        parameter,
      }))
  })
}
