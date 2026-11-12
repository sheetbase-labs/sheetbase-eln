/**
 * The Pipelines board's shapes, as components: the step list, its rows, the reads-and-writes box,
 * line-numbered code and the Form / SQL switch. They carry the board's own class names, styled by
 * `board.css`, so every pipeline screen draws what `PipeFinalStandard.dc.html` draws.
 * Guide: /mnt/project-files/pipelines-system/board-components.md.
 */
import type { ReactNode } from 'react'

import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import type { Tone } from '#/components/ui/status'
import { cn } from '#/lib/utils'
import './board.css'

/** Wrap a pipeline page body in this so the board's tokens and helpers apply. */
export function BoardScope({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return <div className={cn('pb-scope', className)}>{children}</div>
}

/** The bordered card that holds the head, the start, the steps and the output. */
export function BoardList({ children }: { children: ReactNode }) {
  return <div className="pb-list">{children}</div>
}

/** Column titles for a `BoardRow` list. Pass one string per column, five in all after the icon. */
export function BoardHead({
  kind,
  step,
  rows,
  state,
}: {
  kind: string
  step: string
  rows: string
  state: string
}) {
  return (
    <div className="pb-head max-md:hidden">
      <span />
      <span>{kind}</span>
      <span>{step}</span>
      <span className="r">{rows}</span>
      <span>{state}</span>
      <span />
    </div>
  )
}

/** One entry of the list: a row plus anything that opens under it. `ends` is the Starts and Output tint. */
export function BoardBlock({
  ends,
  selected,
  children,
}: {
  ends?: boolean
  selected?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn('pb-blk', ends && 'pb-ends', selected && 'pb-sel')}
      aria-current={selected ? 'step' : undefined}
    >
      {children}
    </div>
  )
}

/** A row: icon, kind, what it does, rows, state, ⋯. `menu` is the ⋯ button, normally `className="more"`. */
export function BoardRow({
  icon,
  kind,
  summary,
  summaryTitle,
  detail,
  rows,
  rowsWarn,
  status,
  expanded,
  label,
  onSelect,
  menu,
}: {
  icon: IconName
  kind: string
  summary: ReactNode
  /** The whole summary, shown on hover when the row cuts it short. */
  summaryTitle?: string
  /** A quiet note after the summary, such as "only if step 5 flags rows". */
  detail?: string
  rows?: string
  rowsWarn?: boolean
  status?: ReactNode
  expanded?: boolean
  label?: string
  onSelect?: () => void
  menu?: ReactNode
}) {
  return (
    <div className="pb-row">
      <span className="ic">
        <Icon name={icon} size={14} />
      </span>
      <span className="k">{kind}</span>
      <span className="s" title={summaryTitle}>
        {onSelect ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={label}
            onClick={onSelect}
          >
            {summary}
            {detail ? <span className="when">{detail}</span> : null}
          </button>
        ) : (
          <>
            {summary}
            {detail ? <span className="when">{detail}</span> : null}
          </>
        )}
      </span>
      <span className={cn('rows num', rowsWarn && 'warn')}>{rows}</span>
      <span className="st">{status}</span>
      {menu ?? <span />}
    </div>
  )
}

/** The bar under the steps that holds "Add step" and its hint. */
export function BoardAdd({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('pb-add', className)} {...rest}>
      {children}
    </div>
  )
}

/** The Reads / Uses / Writes / Next box of the inspector. `mine` tints the row this step owns. */
export function BoardIo({
  rows,
}: {
  rows: Array<{
    label: string
    value: ReactNode
    count?: ReactNode
    mine?: boolean
  }>
}) {
  return (
    <div className="pb-io">
      {rows.map((row) => (
        <div key={row.label} className={row.mine ? 'me' : undefined}>
          <span className="lab">{row.label}</span>
          <span>{row.value}</span>
          <span className="cnt num">{row.count}</span>
        </div>
      ))}
    </div>
  )
}

const SQL_WORDS =
  /\b(SELECT|FROM|WHERE|AS|ROUND|CASE|WHEN|THEN|ELSE|END|JOIN|LEFT|INNER|ON|AND|OR|NOT|IN|IS|NULL|CAST|NULLIF|COALESCE|true|false)\b/

/** One SQL line with the board's colours: keywords, `previous`, quoted text. */
function sqlLine(line: string): ReactNode[] {
  return line.split(/('[^']*'|"[^"]*")/).flatMap((part, i) => {
    if (part.startsWith("'"))
      return [
        <span key={`s${i}`} className="str">
          {part}
        </span>,
      ]

    if (part.startsWith('"')) return [part]

    return part.split(SQL_WORDS).flatMap((piece, j) => {
      if (j % 2 === 1)
        return [
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- the pieces of one line come from splitting it once, so their position is their identity.
          <span key={`k${i}.${j}`} className="kw">
            {piece}
          </span>,
        ]

      return piece.split(/\b(previous)\b/).map((bit, k) =>
        k % 2 === 1 ? (
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- the pieces of one line come from splitting it once, so their position is their identity.
          <span key={`r${i}.${j}.${k}`} className="ref">
            {bit}
          </span>
        ) : (
          bit
        ),
      )
    })
  })
}

/** SQL with the board's line-number gutter and colours. Each string is one line. */
export function BoardCode({
  lines,
  label,
}: {
  lines: string[]
  label?: string
}) {
  return (
    <pre className="code" aria-label={label}>
      {lines.map((line, i) => (
        // SAFETY: the lines are a fixed, ordered snapshot of one statement and never reorder.
        // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- the lines are one statement split once and never reorder, so their position is their identity.
        <span key={`${i}:${line}`} className="l">
          {sqlLine(line)}
        </span>
      ))}
    </pre>
  )
}

/** The board's segmented switch (Form / Edit as SQL, Simple / Standard). */
export function BoardSegmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'on' : undefined}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** The board's `.btn`: default, primary, quiet or danger; `sm` is 24px; `iconOnly` is a quiet 28px square. */
export function BoardButton({
  variant = 'default',
  size = 'md',
  icon,
  iconOnly,
  className,
  type = 'button',
  children,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: 'default' | 'primary' | 'quiet' | 'danger'
  size?: 'md' | 'sm'
  icon?: IconName
  iconOnly?: boolean
  children?: ReactNode
}) {
  return (
    <button
      type={type}
      className={cn(
        'btn',
        variant === 'primary' && 'btn-p',
        variant === 'quiet' && 'btn-q',
        variant === 'danger' && 'btn-danger',
        size === 'sm' && 'btn-s',
        iconOnly && 'ib',
        className,
      )}
      {...rest}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 12 : 14} /> : null}
      {children}
    </button>
  )
}

/** The board's `.input`. Add `mono` for identifiers. */
export function BoardInput({
  mono,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return <input className={cn('input', mono && 'mono', className)} {...rest} />
}

/** The board's `.select`, a native select so it works with a keyboard and on phones. */
export function BoardSelect({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('select', className)} {...rest}>
      {children}
    </select>
  )
}

/** The board's `.status`: a coloured dot and the word. */
export function BoardStatus({
  tone,
  children,
}: {
  tone: Tone
  children: ReactNode
}) {
  return (
    <span className="status">
      <span className={`dot st-${tone}`} aria-hidden="true" />
      {children}
    </span>
  )
}
