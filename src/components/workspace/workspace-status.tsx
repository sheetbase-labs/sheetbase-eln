import type { LinkLetter } from '#/lib/workspace-state'
import { rich, t } from '#/copy'

import type { Hint } from './workspace-status-hints'

/**
 * Re-exported from `workspace-status-hints.ts`, which owns the hint list, so
 * callers that import the hints beside the component keep working.
 */
export { statusHints } from './workspace-status-hints'

export type { Hint } from './workspace-status-hints'

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
