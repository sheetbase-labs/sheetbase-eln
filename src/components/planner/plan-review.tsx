/**
 * A drawn-up experiment, laid out to read before it is created: what will be
 * done, the parts, the plate, the worklist and the samples set aside.
 */
import { Notice } from '#/components/ui/alert'
import { DescriptionList, Section } from '#/components/ui/layout'
import { ObjectLink } from '#/components/ui/object-link'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { t } from '#/copy'
import { plateCounts } from '#/lib/planner/plan'
import type { ExperimentPlan } from '#/lib/planner/plan'

type PlanPart = ExperimentPlan['parts'][number]

type PlanSample = ExperimentPlan['samples'][number]

function useMinutes() {
  return (count: number) => t('planner.view.minutes', { count })
}

/** The parts the plan lays out; a plan may repeat a part title, so rows go by position. */
function partColumns(minutes: (count: number) => string) {
  const columns: RegistryColumn<PlanPart & { position: string }>[] = [
    {
      id: 'part',
      header: t('planner.view.partColumns.part'),
      accessorFn: (part) => part.title,
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.title}
          {row.original.gate ? (
            <span className="ml-2 text-label font-normal text-fg-muted">
              {t(`planner.view.gate.${row.original.gate}`)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'day',
      header: t('planner.view.partColumns.day'),
      accessorFn: (part) => part.dayOffset,
      cell: ({ row }) =>
        t('planner.view.day', { count: row.original.dayOffset + 1 }),
    },
    {
      id: 'handsOn',
      header: t('planner.view.partColumns.handsOn'),
      accessorFn: (part) => part.handsOnMinutes,
      cell: ({ row }) => minutes(row.original.handsOnMinutes),
    },
    {
      id: 'wait',
      header: t('planner.view.partColumns.wait'),
      accessorFn: (part) => part.waitAfterMinutes,
      cell: ({ row }) =>
        row.original.waitAfterMinutes > 0
          ? minutes(row.original.waitAfterMinutes)
          : t('planner.view.noWait'),
    },
    {
      id: 'instruments',
      header: t('planner.view.partColumns.instruments'),
      enableSorting: false,
      cell: ({ row }) =>
        row.original.needs.length > 0
          ? row.original.needs.map((n) => n.name ?? n.instrumentId).join(', ')
          : t('planner.view.noInstruments'),
    },
  ]

  return columns
}

const sampleColumns: RegistryColumn<PlanSample>[] = [
  {
    id: 'sample',
    header: t('planner.view.sampleColumns.sample'),
    accessorFn: (sample) => sample.label,
    cell: ({ row }) => (
      <ObjectLink
        kind="record"
        id={row.original.recordId}
        identifier={row.original.label}
      />
    ),
  },
  {
    id: 'quantity',
    header: t('planner.view.sampleColumns.quantity'),
    accessorFn: (sample) => sample.quantity,
    cell: ({ row }) => `${row.original.quantity} ${row.original.unit ?? ''}`,
  },
]

export function PlanReview({
  goal,
  plan,
}: {
  goal: string
  plan: ExperimentPlan
}) {
  const counts = plateCounts(plan)
  const minutes = useMinutes()

  return (
    <div className="flex flex-col gap-5">
      {plan.warnings.length > 0 ? (
        <Notice tone="warn" title={t('planner.view.warnings')}>
          <ul className="m-0 list-disc pl-5">
            {plan.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <Section title={t('planner.view.goal')}>
        <p className="m-0 text-body">{goal}</p>
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
            <RegistryGrid
              label={t('planner.view.partsTable')}
              rows={plan.parts.map((part, i) => ({
                ...part,
                position: `${part.title}-${i}`,
              }))}
              columns={partColumns(minutes)}
              getRowId={(part) => part.position}
              selectable={false}
            />
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
            <RegistryGrid
              label={t('planner.view.samplesTable')}
              rows={plan.samples}
              columns={sampleColumns}
              getRowId={(sample) => sample.recordId}
              selectable={false}
            />
          </TableBox>
        )}
      </Section>
    </div>
  )
}
