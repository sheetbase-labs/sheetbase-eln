import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Status } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted, Section } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { toast } from '#/components/v3/ui/sonner'
import {
  deletePipelineSchedule,
  updatePipelineSchedule,
} from '#/lib/pipelines/data'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  pipelineDataQueryKeys,
  useSchedules,
} from '#/components/v3/pipelines/pipelines-data'

/** UI port (roadmap-4/ui-app3): pipeline triggers. Schedules are enabled,
 * disabled and deleted through the api RPCs. */
export const Route = createFileRoute('/pipelines/$pipelineId/triggers')({
  component: PipelineTriggers,
})

function PipelineTriggers() {
  const { pipelineId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const queryClient = useQueryClient()
  const schedules = useSchedules(pipelineId)
  const rows = schedules.data ?? []

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: pipelineDataQueryKeys.schedules(pipelineId),
    })

  const toggle = useMutation({
    mutationFn: (input: { scheduleId: string; enabled: boolean }) =>
      updatePipelineSchedule(notebookDataClient, {
        workspaceId,
        scheduleId: input.scheduleId,
        enabled: input.enabled,
      }),
    onSuccess: (updated) => {
      void invalidate()
      toast(updated.enabled ? 'Trigger enabled' : 'Trigger paused')
    },
    onError: (error: unknown) =>
      toast('Could not change the trigger', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  const remove = useMutation({
    mutationFn: (scheduleId: string) =>
      deletePipelineSchedule(notebookDataClient, { workspaceId, scheduleId }),
    onSuccess: () => {
      void invalidate()
      toast('Trigger deleted')
    },
    onError: (error: unknown) =>
      toast('Could not delete the trigger', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <Section title="Triggers" count={rows.length}>
        {rows.length ? (
          <TableBox>
            <Table aria-label="Pipeline triggers">
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>Spec</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead align="right">{''}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.kind}</TableCell>
                    <TableCell className="mono text-caption">
                      {JSON.stringify(s.spec)}
                    </TableCell>
                    <TableCell>
                      <Status tone={s.enabled ? 'ok' : 'stored'}>
                        {s.enabled ? 'Enabled' : 'Paused'}
                      </Status>
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {s.next_run_at
                        ? s.next_run_at.slice(0, 16).replace('T', ' ')
                        : '—'}
                    </TableCell>
                    <TableCell align="right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          disabled={toggle.isPending}
                          onClick={() =>
                            toggle.mutate({
                              scheduleId: s.id,
                              enabled: !s.enabled,
                            })
                          }
                        >
                          {s.enabled ? 'Pause' : 'Enable'}
                        </Button>
                        <Button
                          size="sm"
                          variant="quiet"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(s.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <EmptyState
            icon="calendar"
            title="No triggers"
            body="A pipeline runs when someone presses Run now until a trigger is added."
            className="py-4"
          />
        )}
      </Section>
      <Muted className="mt-4">
        Triggers start runs; they never sign, submit, approve or delete.
      </Muted>
    </div>
  )
}
