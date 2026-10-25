import {
  ChevronLeft,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pin,
  PinOff,
  X,
} from 'lucide-react'

import { Icon } from '#/components/v3/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import { currentPlatform, formatShortcut } from '#/lib/shortcuts'
import { modeLabel } from '#/lib/workspace-state'
import type {
  LinkLetter,
  PaneKind,
  PaneMode,
  WorkspacePane,
} from '#/lib/workspace-state'

export interface PaneHeaderLink {
  letter: LinkLetter
  role: 'drives' | 'follows'
}

export interface PaneHeaderProps {
  pane: WorkspacePane
  number: number
  focused: boolean
  primary: boolean
  mode: PaneMode
  kind: PaneKind
  link?: PaneHeaderLink
  /** A newer revision than the one this pane is pinned to, e.g. `S-16`. */
  newer?: string
  onShelf: boolean
  maximized: boolean
  canClose: boolean
  canLink: boolean
  onFocus: () => void
  onBack: () => void
  onForward: () => void
  onStepTo: (stepsBack: number) => void
  onPin: () => void
  onMakePrimary: () => void
  onMaximize: () => void
  onClose: () => void
  onSplit: (direction: 'row' | 'column') => void
  onToggleLink: () => void
  onMakeDriver: () => void
  onCompareNewer: () => void
  onCopyLink: () => void
}

function key(binding: string) {
  return formatShortcut(binding, currentPlatform())
}

export function PaneHeader(props: PaneHeaderProps) {
  const { pane, mode, kind, link, newer } = props
  const steps = pane.trail.slice(-2)
  const hidden = pane.trail.length - steps.length
  const title = pane.title
  return (
    <div className="mx-ph" data-pane-header>
      <button
        type="button"
        className="mx-num"
        aria-label={`Focus pane ${props.number}`}
        title={`Focus pane ${props.number} (${key(`mod+${props.number}`)})`}
        onClick={props.onFocus}
      >
        {props.number}
      </button>
      {pane.trail.length > 0 ? (
        <span className="mx-trail" role="group" aria-label="Trail">
          <button
            type="button"
            className="mx-back"
            aria-label={`Back to ${pane.trail.at(-1)?.title ?? 'previous page'}`}
            title={`Back (${key('mod+[')})`}
            onClick={props.onBack}
          >
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          {steps.map((step, index) => (
            <span key={`${step.href}-${index}`} className="contents">
              <button
                type="button"
                className="mx-step"
                title={step.title}
                onClick={() => props.onStepTo(steps.length - index)}
              >
                {step.identifier ?? step.title}
              </button>
              <span className="mx-chev" aria-hidden="true">
                ›
              </span>
            </span>
          ))}
          {hidden > 0 ? (
            <span className="sr-only">{hidden} earlier steps</span>
          ) : null}
        </span>
      ) : null}
      <span className="mx-type" title={kind.label}>
        <Icon name={kind.icon} size={16} />
      </span>
      {pane.identifier ? (
        <span className="mx-id">{pane.identifier}</span>
      ) : null}
      <span className="mx-title" title={pane.href}>
        {title}
      </span>
      <ModeBadge mode={mode} />
      {newer ? (
        <button
          type="button"
          className="mx-newer"
          title="Compare against the newer revision"
          onClick={props.onCompareNewer}
        >
          Newer: <b>{newer}</b>
        </button>
      ) : null}
      {link ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="mx-link"
            data-link={link.letter}
            aria-label={`Link ${link.letter.toUpperCase()}, ${link.role === 'drives' ? 'drives the linked panes' : 'follows the driving pane'}`}
          >
            <i aria-hidden="true" />
            <b>{link.letter.toUpperCase()}</b>
            <span>{link.role === 'drives' ? '· Drives →' : '· Follows'}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {link.role === 'follows' ? (
              <DropdownMenuItem onClick={props.onMakeDriver}>
                Make this pane the driver
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={props.onToggleLink} hint={key('mod+l')}>
              Unlink this pane
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <span className="mx-sp" />
      <span className="mx-acts">
        <button
          type="button"
          className="mx-act is-opt"
          aria-pressed={props.onShelf}
          aria-label={props.onShelf ? 'On the shelf' : 'Pin to the shelf'}
          title={`${props.onShelf ? 'On the shelf' : 'Pin to the shelf'} (P)`}
          onClick={props.onPin}
        >
          {props.onShelf ? (
            <PinOff size={14} aria-hidden="true" />
          ) : (
            <Pin size={14} aria-hidden="true" />
          )}
        </button>
        {!props.primary ? (
          <button
            type="button"
            className="mx-act is-opt"
            aria-label="Make primary"
            title={`Make primary: edit here (${key('mod+shift+p')})`}
            onClick={props.onMakePrimary}
          >
            <Icon name="edit" size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className="mx-act is-opt"
          aria-pressed={props.maximized}
          aria-label={props.maximized ? 'Restore layout' : 'Maximise'}
          title={`${props.maximized ? 'Restore layout' : 'Maximise'} (${key('mod+shift+enter')})`}
          onClick={props.onMaximize}
        >
          {props.maximized ? (
            <Minimize2 size={14} aria-hidden="true" />
          ) : (
            <Maximize2 size={14} aria-hidden="true" />
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="mx-act"
            aria-label={`More actions for ${title}`}
          >
            <MoreHorizontal size={14} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => props.onSplit('row')}
              hint={key('mod+\\')}
            >
              Split right
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => props.onSplit('column')}
              hint={key('mod+shift+\\')}
            >
              Split below
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {!props.primary ? (
              <DropdownMenuItem
                onClick={props.onMakePrimary}
                hint={key('mod+shift+p')}
              >
                Make primary
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={props.onPin} hint="P">
              {props.onShelf ? 'Remove from the shelf' : 'Pin to the shelf'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={props.onToggleLink}
              disabled={!link && !props.canLink}
              hint={key('mod+l')}
            >
              {link ? 'Unlink this pane' : 'Link with the next pane'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={props.onMaximize}
              hint={key('mod+shift+enter')}
            >
              {props.maximized ? 'Restore layout' : 'Maximise'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={props.onBack}
              disabled={pane.trail.length === 0}
              hint={key('mod+[')}
            >
              Back in this pane
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={props.onForward}
              disabled={pane.forward.length === 0}
              hint={key('mod+]')}
            >
              Forward in this pane
            </DropdownMenuItem>
            <DropdownMenuItem onClick={props.onCopyLink}>
              Copy link
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={props.onClose}
              disabled={!props.canClose}
              hint={key('mod+w')}
            >
              Close pane
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          className="mx-act"
          aria-label={`Close ${title} pane`}
          title={`Close pane (${key('mod+w')})`}
          disabled={!props.canClose}
          onClick={props.onClose}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </span>
    </div>
  )
}

export function ModeBadge({ mode }: { mode: PaneMode }) {
  const label = modeLabel(mode)
  const [lead, revision] = label.split(' · ')
  if (mode.kind === 'editing') {
    return (
      <span className="mx-mode is-edit" data-pane-mode="editing">
        <Icon name="edit" size={12} />
        {label}
      </span>
    )
  }
  if (mode.kind === 'reviewing') {
    return (
      <span className="mx-mode is-review" data-pane-mode="reviewing">
        <Icon name="comment" size={12} />
        {label}
      </span>
    )
  }
  if (mode.kind === 'signed') {
    return (
      <span className="mx-mode is-signed" data-pane-mode="signed">
        <Icon name="lock" size={12} />
        {label}
      </span>
    )
  }
  return (
    <span className="mx-mode is-ro" data-pane-mode="read-only">
      {lead}
      {revision ? (
        <>
          {' · '}
          <b>{revision}</b>
        </>
      ) : null}
    </span>
  )
}
