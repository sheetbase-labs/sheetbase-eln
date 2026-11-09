/**
 * A drawn-up experiment, laid out to read before it is created: what will be
 * done, the parts, the plate, the worklist and the samples set aside.
 */
import { Notice } from '#/components/ui/alert'
import { DescriptionList, Section } from '#/components/ui/layout'
import { ObjectLink } from '#/components/ui/object-link'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { t } from '#/copy'
import { plateCounts } from '#/lib/planner/plan'
import type { ExperimentPlan } from '#/lib/planner/plan'

export function PlanReview({
  goal,
  plan,
}: {
  goal: string
  plan: ExperimentPlan
}) {
  const counts = plateCounts(plan)

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
            <Table aria-label={t('planner.view.partsTable')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('planner.view.partColumns.part')}</TableHead>
                  <TableHead>{t('planner.view.partColumns.day')}</TableHead>
                  <TableHead>{t('planner.view.partColumns.handsOn')}</TableHead>
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
                      {part.gate ? (
                        <span className="ml-2 text-label font-normal text-fg-muted">
                          {t(`planner.view.gate.${part.gate}`)}
                        </span>
                      ) : null}
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
    </div>
  )
}
