import { currentPlatform, formatShortcut } from '#/lib/shortcuts'
import type { LinkLetter } from '#/lib/workspace-state'
import { rich, t } from '#/copy'

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
  if (paneCount > 1)
    hints.push({
      keys: [k('mod+1')],
      label: t('projects.workspaceStatus.hints.focus'),
    })
  hints.push({
    keys: [k('mod+\\')],
    label: t('projects.workspaceStatus.hints.splitRight'),
  })
  if (!primary)
    hints.push({
      keys: [k('mod+shift+p')],
      label: t('projects.workspaceStatus.hints.makePrimary'),
    })
  if (hasTrail)
    hints.push({
      keys: [k('mod+['), k('mod+]')],
      label: t('projects.workspaceStatus.hints.trail'),
    })
  if (linked)
    hints.push({
      keys: [k('mod+l')],
      label: t('projects.workspaceStatus.hints.unlink'),
    })
  hints.push({
    keys: ['Space'],
    label: t('projects.workspaceStatus.hints.peek'),
  })
  hints.push({
    keys: [platform() === 'mac' ? '⌥↵' : 'Alt+↵'],
    label: t('projects.workspaceStatus.hints.openBeside'),
  })
  if (hints.length < 5)
    hints.push({
      keys: ['P'],
      label: t('projects.workspaceStatus.hints.pin'),
    })
  if (hints.length < 5)
    hints.push({
      keys: [k('mod+w')],
      label: t('projects.workspaceStatus.hints.close'),
    })
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
    <div
      className="mx-status"
      role="status"
      aria-label={t('projects.workspaceStatus.label')}
    >
      <span>
        {rich('projects.workspaceStatus.layout', {
          name: layoutName,
          state: saved
            ? t('projects.workspaceStatus.saved')
            : t('projects.workspaceStatus.unsaved'),
          b: (children) => <b>{children}</b>,
        })}
      </span>
      {link ? (
        <span className="mx-st-link" data-link={link.letter}>
          <i aria-hidden="true" />
          <span>
            {rich('projects.workspaceStatus.link', {
              letter: link.letter.toUpperCase(),
              driver: link.driverLabel,
              count: link.followers,
              b: (children) => <b>{children}</b>,
            })}
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
