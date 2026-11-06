import { createFileRoute } from '@tanstack/react-router'

import { RecordNotebookPage } from '../../records/$recordId/-notebook-page'

/** One part of an experiment's notebook: `/experiments/<id>/notebook/<part number>`.
 * The plain Notebook URL opens the current part. */
export const Route = createFileRoute('/experiments/$expId/notebook_/$part')({
  component: ExperimentNotebookPart,
})

function ExperimentNotebookPart() {
  const { context } = Route.useRouteContext()
  const { expId, part } = Route.useParams()
  return (
    <RecordNotebookPage
      context={context}
      recordId={expId}
      partParam={part}
      embedded
    />
  )
}
