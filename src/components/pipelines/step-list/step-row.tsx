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
import { cn } from '#/lib/utils'

interface StateStatus {
  tone: Tone
  label: string
}

/** The last run's word for a step, in the Run column. */
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
  selected,
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
  selected?: boolean
  expanded?: boolean
  problem?: string
  label: string
  onSelect?: () => void
  menu?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'grid min-h-9 grid-cols-[22px_92px_minmax(0,1fr)_72px_76px_24px] items-center gap-x-2 pl-2.5 pr-2 text-body max-md:grid-cols-[22px_72px_minmax(0,1fr)_auto_24px]',
      )}
    >
      <span className="inline-flex size-[22px] items-center justify-center rounded-md border border-border bg-surface text-fg-muted">
        <Icon name={icon} size={14} />
      </span>
      <span className="mono truncate text-caption font-medium text-fg-muted">
        {kind}
      </span>
      {onSelect ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={label}
          onClick={onSelect}
          className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-body text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span className={selected ? 'font-medium' : undefined}>
            {summary}
          </span>
          {detail ? (
            <span className="ml-1.5 text-label text-fg-muted">{detail}</span>
          ) : null}
        </button>
      ) : (
        <span className="min-w-0 truncate">{summary}</span>
      )}
      <span
        className={cn(
          'num text-right text-label whitespace-nowrap max-md:hidden',
          rowsWarn && 'font-semibold text-warn-text',
        )}
      >
        {rows}
      </span>
      <span className="text-label whitespace-nowrap max-md:text-caption">
        {problem ? (
          <span className="text-danger-text" title={problem}>
            {t('data.stepList.needsAttention')}
          </span>
        ) : (
          status
        )}
      </span>
      {menu ?? <span />}
    </div>
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
        className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-fg-muted hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
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
