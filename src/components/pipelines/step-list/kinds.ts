import { t } from '#/copy'
import type { IconName } from '#/components/icons'
import { PIPELINE_ACTIONS } from '#/lib/pipelines/actions'
import type { PipelineStep, PipelineStepKind } from '#/lib/pipelines/config'
import { noCodeSummary } from '#/lib/pipelines/no-code/summary'
import { isNoCodeKind } from '#/lib/pipelines/no-code/forms'
import { formatLimit } from '#/lib/pipelines/remote/settings'
import { parsePluginName } from '#/lib/extensions/points'

interface KindMeta {
  icon: IconName
  label: string
  hint: string
}

export const KIND_META: Record<PipelineStepKind, KindMeta> = {
  filter: {
    icon: 'filter',
    label: t('data.stepList.kindFilter'),
    hint: t('data.stepList.hintFilter'),
  },
  join: {
    icon: 'move',
    label: t('data.stepList.kindJoin'),
    hint: t('data.stepList.hintJoin'),
  },
  calculate: {
    icon: 'table',
    label: t('data.stepList.kindCalculate'),
    hint: t('data.stepList.hintCalculate'),
  },
  check_ranges: {
    icon: 'check',
    label: t('data.stepList.kindCheckRanges'),
    hint: t('data.stepList.hintCheckRanges'),
  },
  flag: {
    icon: 'tag',
    label: t('data.stepList.kindFlag'),
    hint: t('data.stepList.hintFlag'),
  },
  sql: {
    icon: 'database',
    label: t('data.stepList.kindSql'),
    hint: t('data.stepList.hintSql'),
  },
  python: {
    icon: 'code',
    label: t('data.stepList.kindPython'),
    hint: t('data.stepList.hintPython'),
  },
  plugin: {
    icon: 'plug',
    label: t('data.stepList.kindPlugin'),
    hint: t('data.stepList.hintPlugin'),
  },
  lakehouse: {
    icon: 'database',
    label: t('features.pipelineRemote.kinds.lakehouse'),
    hint: t('features.pipelineRemote.kinds.lakehouseHint'),
  },
  remote_job: {
    icon: 'cpu',
    label: t('features.pipelineRemote.kinds.remoteJob'),
    hint: t('features.pipelineRemote.kinds.remoteJobHint'),
  },
  web_call: {
    icon: 'link',
    label: t('features.pipelineConnections.kind.label'),
    hint: t('features.pipelineConnections.kind.hint'),
  },
  ask: {
    icon: 'user',
    label: t('data.stepList.kindAsk'),
    hint: t('data.stepList.hintAsk'),
  },
  action: {
    icon: 'flask',
    label: t('data.stepList.kindAction'),
    hint: t('data.stepList.hintAction'),
  },
  notify: {
    icon: 'comment',
    label: t('data.stepList.kindNotify'),
    hint: t('data.stepList.hintNotify'),
  },
}

/** The groups of the Add step menu, in order. */
export const ADD_GROUPS: Array<{
  label: string
  kinds: readonly PipelineStepKind[]
}> = [
  {
    label: t('data.stepList.groupNoCode'),
    kinds: ['filter', 'join', 'calculate', 'check_ranges', 'flag'],
  },
  { label: t('data.stepList.groupCode'), kinds: ['sql', 'python', 'plugin'] },
  {
    label: t('features.pipelineRemote.kinds.groupConnect'),
    kinds: ['lakehouse', 'remote_job', 'web_call'],
  },
  { label: t('data.stepList.groupPeople'), kinds: ['ask'] },
  { label: t('data.stepList.groupEln'), kinds: ['action'] },
  { label: t('data.stepList.groupNotify'), kinds: ['notify'] },
]

/** The kind as a row shows it: an ELN action says whether it does or proposes. */
export function kindLabel(step: PipelineStep): string {
  if (step.kind === 'action')
    return step.action.mode === 'execute'
      ? t('data.stepList.kindActionDo')
      : t('data.stepList.kindActionPropose')

  return KIND_META[step.kind].label
}

const ACTION_LABELS = new Map(
  PIPELINE_ACTIONS.map((a) => [a.operation, a.label]),
)

/** `plugin.k.summarise-values` reads as “Summarise values”. */
export function pluginLabel(operation: string): string {
  const known = parsePluginName(operation)

  if (!known) return operation
  const words = known.id.replace(/-/g, ' ')

  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function actionLabel(operation: string): string {
  return ACTION_LABELS.get(operation) ?? pluginLabel(operation)
}

function firstLine(statement: string): string {
  const line = statement
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('import ') && !l.startsWith('#'))

  return (line ?? '').slice(0, 80)
}

/** One line that says what a step does, for the list. */
export function stepSummary(
  step: PipelineStep,
  context: {
    members: Record<string, string>
    destinationName: (subscriptionId: string) => string | undefined
  },
): string {
  if (step.note) return step.note

  if (isNoCodeKind(step.kind) && 'form' in step)
    return noCodeSummary(step.kind, step.form)

  switch (step.kind) {
    case 'sql':
    case 'python':
      return firstLine(step.statement)
    case 'plugin':
      return step.plugin.operation
        ? pluginLabel(step.plugin.operation)
        : t('data.stepList.choosePlugin')
    case 'lakehouse':
      return step.lake.tables.length
        ? t('features.pipelineRemote.summary.lake', {
            tables: step.lake.tables.join(', '),
          })
        : t('features.pipelineRemote.summary.chooseTables')
    case 'remote_job':
      return step.remoteJob.connection
        ? t('features.pipelineRemote.summary.remote', {
            queue: step.remoteJob.queue || '—',
            connection: step.remoteJob.connection,
            limit: formatLimit(step.remoteJob.limitMinutes),
          })
        : t('features.pipelineRemote.summary.chooseConnection')
    case 'web_call':
      return step.webCall.connection
        ? t('features.pipelineConnections.step.summary', {
            method: step.webCall.method,
            path: step.webCall.path,
            connection: step.webCall.connection,
          })
        : t('features.pipelineConnections.editor.chooseConnection')
    case 'ask': {
      const person = context.members[step.ask.askedUserIds[0] ?? '']

      return person
        ? t('data.stepList.summaryAsk', { person })
        : t('data.stepList.summaryAskNobody')
    }

    case 'action':
      return step.action.operation
        ? actionLabel(step.action.operation)
        : t('data.stepList.chooseAction')
    case 'notify':
      return (
        context.destinationName(step.notify.subscriptionId) ??
        t('data.stepList.chooseDestination')
      )
    default:
      return ''
  }
}
