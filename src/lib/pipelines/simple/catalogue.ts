import { t } from '#/copy'
import { words } from './words'
import type { IconName } from '#/components/icons'
import { PIPELINE_ACTIONS } from '../actions'
import type { RecipeAction } from './recipe'

/** What the catalogue needs to know to start a new line off sensibly. */
export interface CatalogueContext {
  /** The column the first condition is about, if there is one. */
  column: string
  /** Fields of the dataset, by column key. */
  fieldIds: Record<string, string>
}

export interface CatalogueItem {
  id: string
  group: 'flag' | 'ask' | 'notify' | 'eln' | 'keep'
  label: string
  icon: IconName
  /** Said at the right of the line: pauses, propose, per policy. */
  hint?: string
  make: (context: CatalogueContext) => RecipeAction
}

/**
 * The ELN actions Simple offers: changes a person would otherwise make by hand,
 * under the action's own policy. Signing, submitting, approving, amending,
 * locking and deleting are never here, whatever the operation registry holds.
 */
const ELN_ACTIONS: Array<{
  operation: string
  label: string
  icon: IconName
  mode: 'execute' | 'propose'
  /** Arguments the choice settles, such as the kind of block. */
  fixed?: Record<string, string>
}> = [
  {
    operation: 'insert_block',
    label: t('features.pipelineSimple.catalogue.eln.insertChart'),
    icon: 'chart',
    mode: 'propose',
    fixed: { p_type: 'chart' },
  },
  {
    operation: 'insert_block',
    label: t('features.pipelineSimple.catalogue.eln.insertTable'),
    icon: 'table',
    mode: 'propose',
    fixed: { p_type: 'table' },
  },
  {
    operation: 'edit_sample',
    label: t('features.pipelineSimple.catalogue.eln.editSample'),
    icon: 'tube',
    mode: 'execute',
  },
  {
    operation: 'create_record_link',
    label: t('features.pipelineSimple.catalogue.eln.linkRecord'),
    icon: 'link',
    mode: 'execute',
  },
]

export function catalogueItems(): CatalogueItem[] {
  const c = words('catalogue.items')
  const p = words('catalogue')

  const items: CatalogueItem[] = [
    {
      id: 'flag',
      group: 'flag',
      label: c('flag'),
      icon: 'warn',
      make: ({ column, fieldIds }) => ({
        kind: 'flag_rows',
        column,
        fieldId: fieldIds[column] ?? '',
      }),
    },
    {
      id: 'check',
      group: 'flag',
      label: c('check'),
      icon: 'filter',
      make: ({ column }) => ({ kind: 'check_range', column }),
    },
    {
      id: 'confirm',
      group: 'ask',
      label: c('confirm'),
      icon: 'user',
      hint: p('pauses'),
      make: () => ({
        kind: 'ask',
        mode: 'confirm',
        userId: '',
        hours: 24,
        noAnswer: 'reask',
      }),
    },
    {
      id: 'choose',
      group: 'ask',
      label: c('choose'),
      icon: 'user',
      hint: p('pauses'),
      make: () => ({
        kind: 'ask',
        mode: 'choose',
        userId: '',
        hours: 24,
        noAnswer: 'reask',
        options: [],
      }),
    },
    {
      id: 'review',
      group: 'flag',
      label: c('review'),
      icon: 'edit',
      make: () => ({ kind: 'inbox', mode: 'review', userId: '', text: '' }),
    },
    {
      id: 'task',
      group: 'ask',
      label: c('task'),
      icon: 'inbox',
      make: () => ({ kind: 'inbox', mode: 'task', userId: '', text: '' }),
    },
    {
      id: 'teams',
      group: 'notify',
      label: c('teams'),
      icon: 'comment',
      make: () => ({ kind: 'notify', channel: 'teams', subscriptionId: '' }),
    },
    {
      id: 'email',
      group: 'notify',
      label: c('email'),
      icon: 'bell',
      make: () => ({ kind: 'notify', channel: 'email', subscriptionId: '' }),
    },
    {
      id: 'webhook',
      group: 'notify',
      label: c('webhook'),
      icon: 'webhook',
      make: () => ({ kind: 'notify', channel: 'webhook', subscriptionId: '' }),
    },
  ]

  for (const eln of ELN_ACTIONS) {
    if (!PIPELINE_ACTIONS.some((action) => action.operation === eln.operation))
      continue

    items.push({
      id: `eln:${eln.operation}:${eln.fixed?.p_type ?? ''}`,
      group: 'eln',
      label: eln.label,
      icon: eln.icon,
      hint: eln.mode === 'propose' ? p('propose') : p('perPolicy'),
      make: () => ({
        kind: 'eln_action',
        operation: eln.operation,
        mode: eln.mode,
        arguments: Object.fromEntries(
          Object.entries(eln.fixed ?? {}).map(([name, value]) => [
            name,
            { value },
          ]),
        ),
      }),
    })
  }

  items.push(
    {
      id: 'append',
      group: 'keep',
      label: c('append'),
      icon: 'download',
      make: () => ({ kind: 'append', datasetId: '' }),
    },
    {
      id: 'create',
      group: 'keep',
      label: c('create'),
      icon: 'plus',
      make: () => ({ kind: 'create', schemaVersionId: '', datasetName: '' }),
    },
  )

  return items
}
