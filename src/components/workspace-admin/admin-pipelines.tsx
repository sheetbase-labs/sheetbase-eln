import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import {
  fetchRunHealthFn,
  togglePipelineScheduleFn,
} from '#/lib/admin-platform'
import { hasCapability } from '#/lib/capability'

import { createDataClient } from '#/lib/data-client'
import {
  listPipelineDefinitions,
  listPipelineSchedules,
  listRecentPipelineRuns,
  pipelineQueryKeys,
} from '#/lib/pipelines/data'
import { formatRelativeTime } from '#/lib/workspace-admin'

const dataClient = createDataClient()

export function AdminPipelines({
  workspaceId,
  role,
}: {
  workspaceId: string
  role: string
}) {
  const queryClient = useQueryClient()
  const canManage = hasCapability(role, 'pipelines.manage')
  const definitionsQuery = useQuery({
    queryKey: pipelineQueryKeys.definitions,
    queryFn: () => listPipelineDefinitions(dataClient),
  })
  const schedulesQuery = useQuery({
    queryKey: pipelineQueryKeys.schedules,
    queryFn: () => listPipelineSchedules(dataClient),
  })
  const runsQuery = useQuery({
    queryKey: [...pipelineQueryKeys.runs('recent'), workspaceId],
    queryFn: () => listRecentPipelineRuns(dataClient, 50),
  })
  const healthQuery = useQuery({
    queryKey: ['admin', workspaceId, 'run-health'],
    queryFn: () => fetchRunHealthFn({ data: { workspaceId } }),
  })
  const toggleSchedule = useMutation({
    mutationFn: ({
      scheduleId,
      enabled,
    }: {
      scheduleId: string
      enabled: boolean
    }) =>
      togglePipelineScheduleFn({
        data: { workspaceId, scheduleId, enabled },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: pipelineQueryKeys.schedules,
      })
    },
  })
  const definitions = definitionsQuery.data ?? []
  const definitionById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  )
  const failedRuns = (runsQuery.data ?? []).filter(
    (run) => run.status === 'failed',
  )

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Pipeline definitions</h2>
          {canManage ? (
            <Button size="sm" variant="outline" asChild>
              <Link to="/pipelines">Author pipelines</Link>
            </Button>
          ) : null}
        </div>
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Lifecycle</TableHead>
                <TableHead>Published version</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {definitions.map((definition) => (
                <TableRow key={definition.id}>
                  <TableCell className="font-medium">
                    {definition.name}
                  </TableCell>
                  <TableCell>{definition.key}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        definition.lifecycle === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-zinc-100 text-zinc-700'
                      }
                    >
                      {definition.lifecycle}
                    </Badge>
                  </TableCell>
                  <TableCell>—</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" asChild>
                      <Link
                        to="/pipelines/$definitionId"
                        params={{ definitionId: definition.id }}
                      >
                        Details
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!definitions.length ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No pipeline definitions.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Schedules</h2>
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pipeline</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Next run</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Timezone</TableHead>
                {canManage ? <TableHead>Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedulesQuery.data?.map((schedule) => {
                const overdue =
                  schedule.enabled &&
                  !!schedule.next_run_at &&
                  new Date(schedule.next_run_at).getTime() < Date.now()
                const timeZone =
                  typeof schedule.spec.timeZone === 'string'
                    ? schedule.spec.timeZone
                    : '—'
                return (
                  <TableRow key={schedule.id}>
                    <TableCell>
                      {definitionById.get(schedule.definition_id)?.name ??
                        'Unknown pipeline'}
                    </TableCell>
                    <TableCell>{schedule.kind}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          schedule.enabled
                            ? 'bg-green-100 text-green-800'
                            : 'bg-zinc-100 text-zinc-700'
                        }
                      >
                        {schedule.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {overdue ? (
                        <span className="text-amber-700">
                          Overdue · {formatRelativeTime(schedule.next_run_at)}
                        </span>
                      ) : (
                        formatRelativeTime(schedule.next_run_at)
                      )}
                    </TableCell>
                    <TableCell>
                      {formatRelativeTime(schedule.last_run_at)}
                    </TableCell>
                    <TableCell>{timeZone}</TableCell>
                    {canManage ? (
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            toggleSchedule.isPending ||
                            toggleSchedule.variables?.scheduleId ===
                              schedule.id
                          }
                          onClick={() =>
                            toggleSchedule.mutate({
                              scheduleId: schedule.id,
                              enabled: !schedule.enabled,
                            })
                          }
                        >
                          {schedule.enabled ? 'Disable' : 'Enable'}
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                )
              })}
              {!schedulesQuery.data?.length ? (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 7 : 6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No schedules.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Recent run health</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            [
              'Running',
              (healthQuery.data?.running ?? []).filter(
                (run) => run.kind !== 'webhook',
              ).length,
            ],
            [
              'Failed',
              (healthQuery.data?.failed ?? []).filter(
                (run) => run.kind !== 'webhook',
              ).length,
            ],
            [
              'Recently succeeded',
              healthQuery.data?.counts.recentlySucceeded ?? 0,
            ],
          ].map(([label, count]) => (
            <div key={label} className="rounded-lg border bg-background p-3">
              <div className="text-xl font-semibold">{count}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Webhook delivery failures are tracked separately —{' '}
          <Link
            to="/admin/$section"
            params={{ section: 'webhooks' }}
            search={{ model: undefined }}
            className="font-medium text-primary hover:underline"
          >
            inspect endpoint health
          </Link>
          .
        </p>
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failedRuns.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link
                      className="hover:underline"
                      to="/pipelines/runs/$runId"
                      params={{ runId: run.id }}
                    >
                      {run.trigger_kind}
                    </Link>
                  </TableCell>
                  <TableCell>{run.status}</TableCell>
                  <TableCell>{formatRelativeTime(run.started_at)}</TableCell>
                  <TableCell
                    className="max-w-md truncate"
                    title={run.error_message ?? undefined}
                  >
                    {run.error_message ?? run.error_code ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
              {!failedRuns.length ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No recent failed runs.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}
