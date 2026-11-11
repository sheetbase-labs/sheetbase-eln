import { useNavigate } from '@tanstack/react-router'

import {
  isBrowserClick,
  openBesideOnAlt,
  useWorkspaceNavigation,
} from '#/components/workspace/workspace-navigation'
import { projectPath } from '#/lib/navigation'

import type { ProjectRow } from './types'

/**
 * How a project opens from the list: a browser-modified click is left to the
 * browser, Alt opens it beside, and a plain open goes to the route (or here).
 */
export function useOpenProject(onOpenProject?: (p: ProjectRow) => void) {
  const workspace = useWorkspaceNavigation()
  const navigate = useNavigate()

  return (project: ProjectRow, event?: React.MouseEvent) => {
    event?.stopPropagation()

    if (event && isBrowserClick(event)) return
    const href = projectPath(project.uuid)

    if (openBesideOnAlt(workspace, href, event, project.name)) return

    if (!event) {
      if (onOpenProject) onOpenProject(project)
      else void navigate({ href })
    }
  }
}
