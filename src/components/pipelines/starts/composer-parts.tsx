import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import { BoardButton } from '#/features/pipelines/board/board'

import './starts-board.css'

/** One line of the composer: icon, what it is, its fields, and a remove or more. */
export function Row({
  icon,
  type,
  children,
  action,
}: {
  icon: IconName
  type: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="cr">
      <Icon name={icon} size={14} />
      <span className="ty">{type}</span>
      <div className="fl">{children}</div>
      {action ?? <span />}
    </div>
  )
}

/** The board's 24px quiet icon button at the end of a line. */
export function RowButton({
  label,
  icon,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string
  icon: IconName
}) {
  return (
    <BoardButton
      variant="quiet"
      iconOnly
      icon={icon}
      aria-label={label}
      title={label}
      {...rest}
    />
  )
}

/** One of the three blocks of the composer card; `head` is its sentence. */
export function Group({
  children,
  head,
}: {
  children: React.ReactNode
  head: React.ReactNode
}) {
  return (
    <div className="cg">
      <div className="cgh">{head}</div>
      {children}
    </div>
  )
}

export const OpTag = ({ children }: { children: React.ReactNode }) => (
  <span className="op">{children}</span>
)

export const LinkButton = ({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick: () => void
}) => (
  <button
    type="button"
    onClick={onClick}
    className="linklike"
    style={{ fontSize: 12 }}
  >
    {children}
  </button>
)
