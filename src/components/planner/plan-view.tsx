/**
 * One plan, laid out to read: what will be done, the parts, the plate, the
 * worklist and the samples set aside. Apply creates everything in one step;
 * nothing exists before that.
 */
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ReadOnlyNote } from '#/components/inventory/list'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { PageHeader, Section, DescriptionList } from '#/components/ui/layout'
import { ObjectLink } from '#/components/ui/object-link'
import { Status } from '#/components/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import { applyPlan, dismissPlan, fetchPlan, planKeys } from '#/lib/planner/data'
import { plateCounts, planReference } from '#/lib/planner/plan'
import { messageOf } from '#/lib/result-quality'

import { PLAN_TONE } from './plans-page'

const client = notebookDataClient

export function PlanView({
  planId,
  canWrite,
}: {
  planId: string
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: planKeys.one(planId),
    queryFn: () => fetchPlan(client, planId),
  })
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: planKeys.all })

  const apply = useMutation({
    mutationFn: () => applyPlan(client, planId),
    onSuccess: () => {
      refresh()
      void queryClient.invalidateQueries({ queryKey: ['records'] })
    },
  })
  const dismiss = useMutation({
    mutationFn: () => dismissPlan(client, planId),
    onSuccess: refresh,
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('planner.view.dismissFailed'))),
  })

  if (query.isError)
    return (
      <div className="p-6">
        <Notice tone="bad" title={t('planner.view.loadError')} />
      </div>
    )
  if (query.isPending) return <div className="p-6" aria-busy="true" />
  const row = query.data
  if (!row)
    return (
      <div className="p-6">
        <Notice tone="warn" title={t('planner.view.notFound')} />
      </div>
    )

  const { plan } = row
  const counts = plateCounts(plan)
  const reference = planReference(row.number)
  const open = row.status === 'proposed'
  const result = row.result

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        trail={[
          { label: t('planner.plans.title'), link: { to: '/plans' } },
          { label: reference },
        ]}
        title={reference}
        meta={
          <span className="flex flex-wrap items-center gap-3 text-label text-fg-muted">
            <Status tone={PLAN_TONE[row.status]}>
              {t(`planner.plans.status.${row.status}`)}
            </Status>
            <span>
              {t('planner.view.by', { when: formatDate(row.created_at) })}{' '}
              {t(`planner.view.sources.${row.source}`)}
            </span>
          </span>
        }
        actions={
          open && canWrite ? (
            <>
              <Button
                variant="quiet"
                disabled={apply.isPending || dismiss.isPending}
                onClick={() => dismiss.mutate()}
              >
                {t('planner.view.dismiss')}
              </Button>
              <Button
                variant="primary"
                disabled={apply.isPending || dismiss.isPending}
                onClick={() => apply.mutate()}
              >
                {apply.isPending
                  ? t('planner.view.applying')
                  : t('planner.view.apply')}
              </Button>
            </>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-5 p-4 md:p-6">
        {apply.isError ? (
          <Notice
            tone="bad"
            title={t('planner.view.applyFailed', {
              message: messageOf(apply.error, ''),
            })}
          >
            {t('planner.view.applyFailedBody', { message: '' })}
          </Notice>
        ) : null}
        {result ? (
          <Notice tone="info" title={t('planner.view.applied')}>
            <span className="flex flex-wrap items-center gap-x-3">
              {t('planner.view.appliedBody', {
                parts: result.parts,
                plate: result.plateRunId ? t('planner.view.appliedPlate') : '',
                worklist: result.worklistId
                  ? t('planner.view.appliedWorklist')
                  : '',
                samples:
                  result.reservations > 0
                    ? t('planner.view.appliedSamples', {
                        count: result.reservations,
                      })
                    : '',
              })}
              <ObjectLink
                kind="record"
                id={result.recordId}
                identifier={result.identifier}
              />
              {result.plateRunId ? (
                <Link
                  to="/plates"
                  search={{ run: result.plateRunId }}
                  className="text-link hover:underline"
                >
                  {t('planner.view.openPlate')}
                </Link>
              ) : null}
            </span>
          </Notice>
        ) : null}
        {row.status === 'dismissed' ? (
          <Notice tone="info" title={t('planner.view.dismissed')} />
        ) : null}
        {plan.warnings.length > 0 && open ? (
          <Notice tone="warn" title={t('planner.view.warnings')}>
            <ul className="m-0 list-disc pl-5">
              {plan.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Notice>
        ) : null}

        <Section title={t('planner.view.goal')}>
          <p className="m-0 text-body">{row.goal}</p>
        </Section>
        <Section title={t('planner.view.summary')}>
          <p className="m-0 text-body">{plan.summary}</p>
          {plan.rationale ? (
            <p className="m-0 text-label text-fg-muted">{plan.rationale}</p>
          ) : null}
        </Section>
        <Section title={t('planner.view.experiment')}>
          <DescriptionList
            labelWidth={140}
            items={[
              [t('planner.view.experiment'), plan.experiment.title],
              [
                t('planner.view.startsFrom'),
                plan.experiment.templateRecordId ? (
                  <ObjectLink
                    kind="record"
                    id={plan.experiment.templateRecordId}
                    identifier={plan.experiment.templateLabel}
                  />
                ) : (
                  t('planner.view.startsBlank')
                ),
              ],
              [
                t('planner.view.schedule'),
                plan.schedule
                  ? t('planner.view.scheduleOn')
                  : t('planner.view.scheduleOff'),
              ],
            ]}
          />
        </Section>
        <Section title={t('planner.view.parts')} count={plan.parts.length}>
          {plan.parts.length === 0 ? (
            <p className="m-0 text-label text-fg-muted">
              {t('planner.view.noParts')}
            </p>
          ) : (
            <TableBox>
              <Table aria-label={t('planner.view.partsTable')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('planner.view.partColumns.part')}</TableHead>
                    <TableHead>{t('planner.view.partColumns.day')}</TableHead>
                    <TableHead>
                      {t('planner.view.partColumns.handsOn')}
                    </TableHead>
                    <TableHead>{t('planner.view.partColumns.wait')}</TableHead>
                    <TableHead>
                      {t('planner.view.partColumns.instruments')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.parts.map((part, i) => (
                    <TableRow key={`${part.title}-${i}`}>
                      <TableCell className="font-medium">
                        {part.title}
                      </TableCell>
                      <TableCell>
                        {t('planner.view.day', { count: part.dayOffset + 1 })}
                      </TableCell>
                      <TableCell>
                        {t('planner.view.minutes', {
                          count: part.handsOnMinutes,
                        })}
                      </TableCell>
                      <TableCell>
                        {part.waitAfterMinutes > 0
                          ? t('planner.view.minutes', {
                              count: part.waitAfterMinutes,
                            })
                          : t('planner.view.noWait')}
                      </TableCell>
                      <TableCell>
                        {part.needs.length > 0
                          ? part.needs
                              .map((n) => n.name ?? n.instrumentId)
                              .join(', ')
                          : t('planner.view.noInstruments')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          )}
        </Section>
        <Section title={t('planner.view.plate')}>
          <p className="m-0 text-body">
            {plan.plate
              ? t('planner.view.plateSummary', {
                  format: plan.plate.format.replace('_well', '-well'),
                  samples: counts.samples,
                  controls: counts.controls,
                })
              : t('planner.view.plateNone')}
          </p>
        </Section>
        <Section title={t('planner.view.worklist')}>
          <p className="m-0 text-body">
            {plan.worklist
              ? t('planner.view.worklistSummary', {
                  count: plan.worklist.transfers.length,
                  source: plan.worklist.sourcePlate,
                  format: plan.worklist.format,
                })
              : t('planner.view.worklistNone')}
          </p>
        </Section>
        <Section title={t('planner.view.samples')} count={plan.samples.length}>
          {plan.samples.length === 0 ? (
            <p className="m-0 text-label text-fg-muted">
              {t('planner.view.samplesNone')}
            </p>
          ) : (
            <TableBox>
              <Table aria-label={t('planner.view.samplesTable')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t('planner.view.sampleColumns.sample')}
                    </TableHead>
                    <TableHead>
                      {t('planner.view.sampleColumns.quantity')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.samples.map((s) => (
                    <TableRow key={s.recordId}>
                      <TableCell>
                        <ObjectLink
                          kind="record"
                          id={s.recordId}
                          identifier={s.label}
                        />
                      </TableCell>
                      <TableCell>
                        {s.quantity} {s.unit ?? ''}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          )}
        </Section>
        {!canWrite ? (
          <ReadOnlyNote>{t('planner.view.readOnly')}</ReadOnlyNote>
        ) : null}
      </div>
    </div>
  )
}
