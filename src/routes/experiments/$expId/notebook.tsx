import { createFileRoute } from '@tanstack/react-router'

import { RecordNotebookPage } from '../../records/$recordId/notebook'

/** The Notebook tab of the experiment page: the working notebook, with the
 * experiment's header above it. */
export const Route = createFileRoute('/experiments/$expId/notebook')({
  component: ExperimentNotebookTab,
})

function ExperimentNotebookTab() {
  const { context } = Route.useRouteContext()
  const { expId } = Route.useParams()
  return <RecordNotebookPage context={context} recordId={expId} embedded />
}
