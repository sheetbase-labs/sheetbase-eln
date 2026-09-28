import { createFileRoute, Link } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'

/** UI port: the experiment Notebook tab. The notebook editor port is pending,
 * so this points at the working record notebook instead of faking a canvas. */
export const Route = createFileRoute('/experiments/$expId/notebook')({
  component: NotebookPointer,
})

function NotebookPointer() {
  const { expId } = Route.useParams()
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <EmptyState
        icon="flask"
        title="The notebook editor is not ported yet"
        body="The working notebook for this experiment is still on the record route until the notebook surface is ported."
      >
        <Button
          nativeButton={false}
          render={
            <Link
              to="/records/$recordId/notebook"
              params={{ recordId: expId }}
            />
          }
        >
          Open the notebook
        </Button>
      </EmptyState>
    </div>
  )
}
