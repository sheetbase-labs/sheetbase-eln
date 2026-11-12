import { t } from '#/copy'
import type { IconName } from '#/components/icons'
import type { PickerOption } from '#/components/record-picker/entity-picker'
import { AGENT_ACTION_AREAS, agentActionArea } from '#/lib/agent-action-policy'
import { parsePluginName } from '#/lib/extensions/points'
import type { PipelineActionDefinition } from '#/lib/pipelines/actions'
import { actionLabel } from './kinds'

/** The area facet the action picker filters on. */
export const ACTION_AREA_FACET = 'area'

const RECORDS = t('data.stepList.actionGroupRecords')
const NOTEBOOK = 'Notebook'
const PLUGINS = t('data.stepList.actionGroupPlugins')
const OTHER = 'Other'

/** Each part of the lab's mark in the list; anything new falls back to a plain dot. */
const AREA_ICONS = new Map<string, IconName>([
  [RECORDS, 'file'],
  [NOTEBOOK, 'fileText'],
  ['Orders and stock', 'box'],
  ['Samples', 'tube'],
  ['Instruments', 'cpu'],
  ['Experiments', 'flask'],
  ['Plates', 'grid'],
  ['Shipments and requests', 'arrowRightLeft'],
  ['Registry', 'dna'],
  ['Studies and planning', 'calendar'],
  ['Reports and analysis', 'chart'],
  ['Compliance', 'lock'],
  ['Agents and AI', 'spark'],
  ['Datasets', 'database'],
  ['People and workspace', 'user'],
  ['Pipelines and plugins', 'pipeline'],
  ['Remote jobs and lakehouse SQL', 'cpu'],
  ['Projects, folders and audit', 'folder'],
  ['Models, sheets and templates', 'schema'],
  ['Workspace set-up', 'settings'],
  [PLUGINS, 'puzzle'],
  [OTHER, 'circle'],
])

/** The actions on any record, whatever its type. */
const RECORD_ACTIONS =
  /^(create_model|archive|restore)_record$|^update_record_custom_fields$|^create_record_link$|_record_alias$/

/**
 * Which part of the lab an action belongs to: the same groups the agent
 * permissions list uses, with the record and notebook actions every pipeline
 * reaches for pulled out of Other.
 */
export function actionArea(operation: string): string {
  if (parsePluginName(operation)) return PLUGINS

  if (RECORD_ACTIONS.test(operation)) return RECORDS

  const area = agentActionArea(operation)

  if (area !== OTHER) return area

  if (/block/.test(operation)) return NOTEBOOK

  if (/booking/.test(operation)) return 'Instruments'

  if (operation.startsWith('set_part_')) return 'Experiments'

  return OTHER
}

const ORDER = [RECORDS, NOTEBOOK, ...AGENT_ACTION_AREAS, PLUGINS, OTHER]

const rank = (area: string) => {
  const at = ORDER.indexOf(area)

  return at === -1 ? ORDER.length : at
}

/** The pipeline actions as picker rows: grouped by area, with a mark, what each does, and whether it can be proposed. */
export function actionOptions(
  definitions: readonly PipelineActionDefinition[],
): PickerOption[] {
  return definitions
    .map((d, index) => ({ d, index, area: actionArea(d.operation) }))
    .sort((a, b) => rank(a.area) - rank(b.area) || a.index - b.index)
    .map(({ d, area }) => ({
      id: d.operation,
      label: actionLabel(d.operation) || d.label,
      detail: d.description,
      icon: AREA_ICONS.get(area) ?? 'circle',
      group: area === OTHER ? t('data.stepList.actionGroupOther') : area,
      facets: { [ACTION_AREA_FACET]: area },
      keywords: [d.operation],
      status: d.proposalKind
        ? {
            tone: 'review' as const,
            label: t('data.stepList.actionCanPropose'),
          }
        : undefined,
    }))
}
