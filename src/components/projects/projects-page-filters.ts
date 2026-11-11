import type { ProjectsTab } from './projects-page'

/** How a tab treats archived projects. */
export type ArchivedMode = 'include' | 'exclude'

/** Only the Archived tab lists archived work; every other tab hides it. */
export function archivedModeFor(tab: ProjectsTab): ArchivedMode {
  return tab === 'archived' ? 'include' : 'exclude'
}
