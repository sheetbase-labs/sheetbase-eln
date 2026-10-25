import { currentPlatform, formatShortcut } from '#/lib/shortcuts'
import type { LinkLetter } from '#/lib/workspace-state'

interface Hint {
  keys: string[]
  label: string
}

const platform = () => currentPlatform()
const k = (binding: string) => formatShortcut(binding, platform())

/** Up to five hints, chosen for the focused pane (the design's status bar). */
export function statusHints({
  hasTrail,
  linked,
  primary,
  paneCount,
}: {
  hasTrail: boolean
  linked: boolean
  primary: boolean
  paneCount: number
}): Hint[] {
  const hints: Hint[] = []
  if (paneCount > 1) hints.push({ keys: [k('mod+1')], label: 'Focus pane' })
  hints.push({ keys: [k('mod+\\')], label: 'Split right' })
  if (!primary) hints.push({ keys: [k('mod+shift+p')], label: 'Make primary' })
  if (hasTrail) hints.push({ keys: [k('mod+['), k('mod+]')], label: 'Trail' })
  if (linked) hints.push({ keys: [k('mod+l')], label: 'Unlink' })
  hints.push({ keys: ['Space'], label: 'Peek' })
  hints.push({
    keys: [platform() === 'mac' ? '⌥↵' : 'Alt+↵'],
    label: 'Open beside',
  })
  if (hints.length < 5) hints.push({ keys: ['P'], label: 'Pin to shelf' })
  if (hints.length < 5) hints.push({ keys: [k('mod+w')], label: 'Close pane' })
  return hints.slice(0, 5)
}

export function WorkspaceStatus({
  layoutName,
  saved,
  link,
  hints,
}: {
  layoutName: string
  saved: boolean
  link?: { letter: LinkLetter; driverLabel: string; followers: number }
  hints: Hint[]
}) {
  return (
    <div className="mx-status" role="status" aria-label="Workspace status">
      <span>
        Layout: <b>{layoutName}</b> · {saved ? 'saved' : 'unsaved'}
      </span>
      {link ? (
        <span className="mx-st-link" data-link={link.letter}>
          <i aria-hidden="true" />
          <span>
            <b>Link {link.letter.toUpperCase()}</b> · {link.driverLabel} drives{' '}
            {link.followers} {link.followers === 1 ? 'pane' : 'panes'} · Sync
            scroll on
          </span>
        </span>
      ) : null}
      <span className="mx-hints">
        {hints.map((hint) => (
          <span key={hint.label} className="mx-hint">
            {hint.keys.map((key) => (
              <kbd key={key} className="mx-kbd">
                {key}
              </kbd>
            ))}
            {hint.label}
          </span>
        ))}
      </span>
    </div>
  )
}
