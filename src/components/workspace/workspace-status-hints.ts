import { currentPlatform, formatShortcut } from '#/lib/shortcuts'
import { t } from '#/copy'

/** One key hint in the workspace status bar. */
export interface Hint {
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
