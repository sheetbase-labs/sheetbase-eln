import { t } from '#/copy'
import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { Tone } from '#/components/ui/status'
import { BoardRow } from '#/features/pipelines/board/board'

interface StateStatus {
  tone: Tone
  label: string
}

/** The last run's word for a step, in the Run column. */
// react-doctor-disable-next-line react-doctor/only-export-components -- runStateStatus words a run state for the list row beside it; both read the same states.
export function runStateStatus(
  state:
    | 'done'
    | 'failed'
    | 'waiting'
    | 'running'
    | 'not_started'
    | 'new'
    | undefined,
  version: number | undefined,
): StateStatus {
  switch (state) {
    case 'done':
      return { tone: 'ok', label: t('data.stepList.statePassed') }
    case 'failed':
      return { tone: 'bad', label: t('data.stepList.stateFailed') }
    case 'waiting':
      return { tone: 'warn', label: t('data.stepList.stateWaiting') }
    case 'running':
      return { tone: 'progress', label: t('data.stepList.stateRunning') }
    case 'new':
      return {
        tone: 'draft',
        label: t('data.stepList.stateNewIn', { version: version ?? 0 }),
      }
    default:
      return { tone: 'none', label: t('data.stepList.stateNotYet') }
  }
}

/** One row of the step list: icon, kind, summary, rows from the last try, the last run's word, ⋯. */
export function StepRow({
  icon,
  kind,
  summary,
  detail,
  rows,
  rowsWarn,
  status,
  expanded,
  problem,
  label,
  onSelect,
  menu,
}: {
  icon: IconName
  kind: string
  summary: string
  /** A quiet note after the summary, such as "skipped when no rows". */
  detail?: string
  rows?: string
  rowsWarn?: boolean
  status?: React.ReactNode
  expanded?: boolean
  problem?: string
  label: string
  onSelect?: () => void
  menu?: React.ReactNode
}) {
  return (
    <BoardRow
      icon={icon}
      kind={kind}
      summary={summary}
      detail={detail}
      rows={rows}
      rowsWarn={rowsWarn}
      status={
        problem ? (
          <span className="text-danger-text" title={problem}>
            {t('data.stepList.needsAttention')}
          </span>
        ) : (
          status
        )
      }
      expanded={expanded}
      label={onSelect ? label : undefined}
      onSelect={onSelect}
      menu={menu}
    />
  )
}

/** The ⋯ of a step row. */
export function StepMenu({
  label,
  index,
  count,
  convertible,
  onMove,
  onDuplicate,
  onRemove,
  onConvert,
}: {
  label: string
  index: number
  count: number
  convertible: boolean
  onMove: (by: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
  onConvert: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className="more focus-visible:outline-2 focus-visible:outline-focus"
      >
        <Icon name="more" size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          icon="arrowUp"
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          {t('data.stepList.moveUp')}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon="arrowDown"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          {t('data.stepList.moveDown')}
        </DropdownMenuItem>
        <DropdownMenuItem icon="copy" onClick={onDuplicate}>
          {t('data.stepList.duplicateStep')}
        </DropdownMenuItem>
        {convertible ? (
          <DropdownMenuItem icon="code" onClick={onConvert}>
            {t('data.stepList.editAsSql')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem icon="trash" danger onClick={onRemove}>
          {t('data.stepList.removeStep')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
