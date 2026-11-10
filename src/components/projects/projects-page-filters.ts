import type { ProjectsTab } from './projects-page'

/** How a tab treats archived projects. */
export type ArchivedMode = 'include' | 'exclude'

/** `all` and `archived` list archived work; the status tabs hide it. */
export function archivedModeFor(tab: ProjectsTab): ArchivedMode {
  return tab === 'all' || tab === 'archived' ? 'include' : 'exclude'
}
