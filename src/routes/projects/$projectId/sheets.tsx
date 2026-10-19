import { createFileRoute, redirect } from '@tanstack/react-router'

import { ProjectSheets } from '#/components/v3/projects/project-sheets'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** The project's Sheets tab: the working sheets in this project, with Rename
 * and Archive on each and a New sheet that arrives with the project chosen. */
export const Route = createFileRoute('/projects/$projectId/sheets')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) throw redirect(signInRedirect(location))
    return { context }
  },
  component: ProjectSheetsTab,
})

function ProjectSheetsTab() {
  const { projectId } = Route.useParams()
  return <ProjectSheets projectId={projectId} />
}
