/**
 * One campaign: its design, budget, rounds and best result so far. The
 * optimiser only proposes; a person approves each round, and nothing is made
 * until they do.
 */
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { DescriptionList, PageHeader, Section } from '#/components/ui/layout'
import { ObjectLink } from '#/components/ui/object-link'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
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
import {
  bestObservation,
  campaignBudget,
  scoreObservations,
} from '#/lib/campaigns/campaign'
import type {
  CampaignRoundRow,
  CampaignRow,
  Factor,
  Objective,
  Observation,
  RoundStatus,
} from '#/lib/campaigns/campaign'
import {
  approveRound,
  campaignKeys,
  fetchCampaign,
  fetchRounds,
  pullPlateResults,
  recordResults,
  rejectRound,
  requestRound,
  setCampaignStatus,
  startCampaign,
} from '#/lib/campaigns/data'
import { notebookDataClient } from '#/lib/notebook-data'
import { messageOf } from '#/lib/result-quality'

import { CAMPAIGN_TONE } from './campaigns-page'
import { DesignDialog } from './design-dialog'

const client = notebookDataClient

const ROUND_TONE: Record<RoundStatus, Tone> = {
  requested: 'progress',
  proposing: 'progress',
  proposed: 'review',
  approved: 'lab',
  completed: 'ok',
  rejected: 'draft',
  failed: 'bad',
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000)

function factorRange(f: Factor): string {
  return f.kind === 'continuous'
    ? t('planner.campaign.range', {
        min: fmt(f.min ?? 0),
        max: fmt(f.max ?? 0),
      }) + (f.unit ? ` ${f.unit}` : '')
    : (f.values ?? []).join(', ') + (f.unit ? ` ${f.unit}` : '')
}

function goalText(o: Objective): string {
  return o.direction === 'target'
    ? t('planner.campaign.directionTarget', { target: fmt(o.target ?? 0) })
    : t(`planner.campaign.directions.${o.direction}`)
}

/** Every result in, round by round, as observations the scorer understands. */
function observationsOf(rounds: CampaignRoundRow[], objectives: Objective[]) {
  const rows: Array<Observation & { round: number; trial: number }> = []
  for (const r of [...rounds].sort((a, b) => a.number - b.number))
    if (r.status === 'completed' || r.status === 'approved')
      for (const trial of r.trials) {
        const values = trial.results
        if (
          values &&
          objectives.every((o) => typeof values[o.key] === 'number')
        )
          rows.push({
            factors: trial.factors,
            values,
            round: r.number,
            trial: trial.trial,
          })
      }
  return rows
}

export function CampaignView({
  recordId,
  canWrite,
}: {
  recordId: string
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const [designing, setDesigning] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)

  const query = useQuery({
    queryKey: campaignKeys.one(recordId),
    queryFn: () => fetchCampaign(client, recordId),
    refetchInterval: 5000,
  })
  const roundsQuery = useQuery({
    queryKey: campaignKeys.rounds(recordId),
    queryFn: () => fetchRounds(client, recordId),
    refetchInterval: 5000,
  })
  const rounds = useMemo(() => roundsQuery.data ?? [], [roundsQuery.data])
  const campaign = query.data?.campaign ?? null
  const record = query.data?.record ?? null

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: campaignKeys.all })
  const fail = (fallback: string) => (e: unknown) =>
    toast.error(messageOf(e, fallback))

  const start = useMutation({
    mutationFn: () => startCampaign(client, recordId),
    onSuccess: () => {
      refresh()
      toast.success(t('planner.campaign.started'))
    },
    onError: fail(t('planner.campaign.couldNotChange')),
  })
  const setStatus = useMutation({
    mutationFn: (status: 'paused' | 'finished') =>
      setCampaignStatus(client, recordId, status),
    onSuccess: (_row, status) => {
      refresh()
      toast.success(
        status === 'paused'
          ? t('planner.campaign.paused')
          : t('planner.campaign.finished'),
      )
    },
    onError: fail(t('planner.campaign.couldNotChange')),
  })
  const ask = useMutation({
    mutationFn: () => requestRound(client, recordId),
    onSuccess: () => {
      refresh()
      toast.success(t('planner.campaign.roundAsked'))
    },
    onError: fail(t('planner.campaign.couldNotAsk')),
  })

  if (query.isError)
    return (
      <div className="p-6">
        <Notice tone="bad" title={t('planner.campaign.loadError')} />
      </div>
    )
  if (query.isPending) return <div className="p-6" aria-busy="true" />
  if (!record)
    return (
      <div className="p-6">
        <Notice tone="warn" title={t('planner.campaign.notFound')} />
      </div>
    )

  const budget = campaign ? campaignBudget(campaign, rounds) : null
  const observations = campaign
    ? observationsOf(rounds, campaign.objectives)
    : []
  const best = campaign
    ? bestObservation(campaign.objectives, observations)
    : null
  const waiting = rounds.some((r) =>
    ['requested', 'proposing', 'proposed', 'approved'].includes(r.status),
  )
  const selected: CampaignRoundRow | null =
    rounds.find((r) => r.id === picked) ??
    (rounds.length > 0 ? rounds[0] : null)
  const locked = rounds.length > 0

  const actions =
    canWrite && campaign ? (
      <>
        {campaign.status === 'draft' ? (
          <Button
            variant="primary"
            disabled={start.isPending || campaign.factors.length === 0}
            onClick={() => start.mutate()}
          >
            {t('planner.campaign.start')}
          </Button>
        ) : null}
        {campaign.status === 'active' ? (
          <>
            <Button
              disabled={ask.isPending || waiting || budget?.roundsLeft === 0}
              onClick={() => ask.mutate()}
            >
              {ask.isPending
                ? t('planner.campaign.askingRound')
                : t('planner.campaign.askRound')}
            </Button>
            <Button
              variant="quiet"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate('paused')}
            >
              {t('planner.campaign.pause')}
            </Button>
          </>
        ) : null}
        {campaign.status === 'paused' ? (
          <Button
            variant="primary"
            disabled={start.isPending}
            onClick={() => start.mutate()}
          >
            {t('planner.campaign.resume')}
          </Button>
        ) : null}
        {campaign.status !== 'finished' && campaign.status !== 'draft' ? (
          <Button variant="quiet" onClick={() => setFinishing(true)}>
            {t('planner.campaign.finish')}
          </Button>
        ) : null}
      </>
    ) : undefined

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        trail={[
          {
            label: t('planner.campaigns.title'),
            link: { to: '/campaigns' },
          },
          { label: record.identifier, mono: true },
        ]}
        title={record.title}
        meta={
          <span className="flex flex-wrap items-center gap-3 text-label text-fg-muted">
            {campaign ? (
              <Status tone={CAMPAIGN_TONE[campaign.status]}>
                {t(`planner.campaigns.status.${campaign.status}`)}
              </Status>
            ) : (
              <Status tone="none">
                {t('planner.campaigns.status.notSetUp')}
              </Status>
            )}
            <Link
              to="/models/$modelId/records/$recordId"
              params={{ modelId: record.kind, recordId: record.id }}
              className="text-link hover:underline"
            >
              {record.identifier}
            </Link>
          </span>
        }
        actions={actions}
      />
      <div className="flex flex-col gap-5 p-4 md:p-6">
        {!campaign ? (
          <Notice tone="info" title={t('planner.campaign.notDesigned')}>
            {canWrite ? (
              <Button
                size="sm"
                className="mt-2"
                onClick={() => setDesigning(true)}
              >
                {t('planner.campaign.setDesign')}
              </Button>
            ) : null}
          </Notice>
        ) : (
          <>
            <p className="m-0 text-label text-fg-muted">
              {t('planner.campaign.advisory')}
            </p>
            <Section
              title={t('planner.campaign.design')}
              action={
                canWrite ? (
                  <Button size="sm" onClick={() => setDesigning(true)}>
                    {t('planner.campaign.editDesign')}
                  </Button>
                ) : undefined
              }
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="m-0 text-label font-medium">
                    {t('planner.campaign.factors')}
                  </h3>
                  <TableBox>
                    <Table aria-label={t('planner.campaign.factors')}>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            {t('planner.campaign.factorColumns.factor')}
                          </TableHead>
                          <TableHead>
                            {t('planner.campaign.factorColumns.kind')}
                          </TableHead>
                          <TableHead>
                            {t('planner.campaign.factorColumns.range')}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {campaign.factors.map((f) => (
                          <TableRow key={f.key}>
                            <TableCell className="font-medium">
                              {f.label}
                            </TableCell>
                            <TableCell>
                              {t(`planner.campaign.kinds.${f.kind}`)}
                            </TableCell>
                            <TableCell className="num">
                              {factorRange(f)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableBox>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="m-0 text-label font-medium">
                    {t('planner.campaign.objectives')}
                  </h3>
                  <TableBox>
                    <Table aria-label={t('planner.campaign.objectives')}>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            {t('planner.campaign.objectiveColumns.objective')}
                          </TableHead>
                          <TableHead>
                            {t('planner.campaign.objectiveColumns.goal')}
                          </TableHead>
                          <TableHead>
                            {t('planner.campaign.objectiveColumns.weight')}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {campaign.objectives.map((o) => (
                          <TableRow key={o.key}>
                            <TableCell className="font-medium">
                              {o.label}
                              {o.unit ? ` (${o.unit})` : ''}
                            </TableCell>
                            <TableCell>{goalText(o)}</TableCell>
                            <TableCell className="num">
                              {o.weight ?? 1}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableBox>
                </div>
              </div>
              <DescriptionList
                className="mt-2"
                labelWidth={140}
                items={[
                  [
                    t('planner.campaign.budget'),
                    <span key="b">
                      {t('planner.campaign.budgetRounds', {
                        count: campaign.max_rounds,
                      })}
                      {', '}
                      {campaign.max_runs === null
                        ? t('planner.campaign.budgetNoRuns')
                        : t('planner.campaign.budgetRuns', {
                            count: campaign.max_runs,
                          })}
                      {', '}
                      {t('planner.campaign.batch', {
                        count: campaign.batch_size,
                      })}
                    </span>,
                  ],
                  [
                    t('planner.campaign.plateSection'),
                    campaign.layout.plateFormat
                      ? t('planner.campaign.plateSummary', {
                          format: campaign.layout.plateFormat.replace(
                            '_well',
                            '-well',
                          ),
                          replicates: campaign.layout.replicates ?? 1,
                          blanks: campaign.layout.blanks ?? 0,
                          negatives: campaign.layout.negatives ?? 0,
                          positives: campaign.layout.positives ?? 0,
                        }) +
                        (campaign.layout.worklistFormat &&
                        campaign.layout.volumeUl
                          ? `. ${t('planner.campaign.worklistSummary', {
                              format: campaign.layout.worklistFormat,
                              volume: campaign.layout.volumeUl,
                            })}`
                          : '')
                      : t('planner.campaign.plateNone'),
                  ],
                  [
                    t('planner.campaign.engine'),
                    t(`planner.campaign.engines.${campaign.engine}`),
                  ],
                  [
                    t('planner.campaign.rounds'),
                    campaign.auto_propose
                      ? t('planner.campaign.nextRound')
                      : t('planner.campaign.nextRoundManual'),
                  ],
                  [
                    t('planner.designDialog.protocol'),
                    campaign.template_record_id ? (
                      <ObjectLink
                        key="p"
                        kind="record"
                        id={campaign.template_record_id}
                      />
                    ) : (
                      t('planner.campaign.protocolNone')
                    ),
                  ],
                ]}
              />
            </Section>

            <Section title={t('planner.campaign.best')}>
              {best ? (
                <div className="flex flex-col gap-1">
                  <p className="m-0 text-body">
                    {campaign.objectives
                      .map(
                        (o) =>
                          `${o.label}: ${fmt(best.observation.values[o.key])}${o.unit ? ` ${o.unit}` : ''}`,
                      )
                      .join(' · ')}
                  </p>
                  <p className="m-0 text-label text-fg-muted">
                    {t('planner.campaign.bestFrom', {
                      round: best.observation.round,
                      trial: best.observation.trial,
                    })}
                    {': '}
                    {campaign.factors
                      .map(
                        (f) =>
                          `${f.label} ${String(best.observation.factors[f.key])}${f.unit ? ` ${f.unit}` : ''}`,
                      )
                      .join(', ')}
                  </p>
                  <Convergence
                    objectives={campaign.objectives}
                    observations={observations}
                  />
                </div>
              ) : (
                <p className="m-0 text-label text-fg-muted">
                  {t('planner.campaign.noBest')}
                </p>
              )}
            </Section>

            <Section title={t('planner.campaign.rounds')} count={rounds.length}>
              {rounds.length === 0 ? (
                <p className="m-0 text-label text-fg-muted">
                  {t('planner.campaign.noRounds')}
                </p>
              ) : (
                <TableBox>
                  <Table aria-label={t('planner.campaign.roundsTable')}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {t('planner.campaign.roundColumns.round')}
                        </TableHead>
                        <TableHead>
                          {t('planner.campaign.roundColumns.status')}
                        </TableHead>
                        <TableHead>
                          {t('planner.campaign.roundColumns.trials')}
                        </TableHead>
                        <TableHead>
                          {t('planner.campaign.roundColumns.engine')}
                        </TableHead>
                        <TableHead>
                          {t('planner.campaign.roundColumns.experiment')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rounds.map((r) => (
                        <TableRow
                          key={r.id}
                          data-state={
                            selected?.id === r.id ? 'selected' : undefined
                          }
                          className="cursor-pointer"
                          onClick={() => setPicked(r.id)}
                        >
                          <TableCell className="font-medium">
                            <button
                              type="button"
                              className="text-left text-link hover:underline"
                              onClick={(e) => {
                                e.stopPropagation()
                                setPicked(r.id)
                              }}
                            >
                              {t('planner.campaign.round', {
                                number: r.number,
                              })}
                            </button>
                          </TableCell>
                          <TableCell>
                            <Status tone={ROUND_TONE[r.status]}>
                              {t(`planner.campaign.roundStatus.${r.status}`)}
                            </Status>
                          </TableCell>
                          <TableCell className="num">
                            {r.trials.length}
                          </TableCell>
                          <TableCell>
                            {r.engine
                              ? t('planner.campaign.roundEngine', {
                                  engine:
                                    r.engine === 'baybe' ||
                                    r.engine === 'builtin'
                                      ? t(
                                          `planner.campaign.engines.${r.engine}`,
                                        )
                                      : r.engine,
                                  version: r.engine_version ?? '',
                                })
                              : ''}
                          </TableCell>
                          <TableCell>
                            {r.experiment_record_id ? (
                              <ObjectLink
                                kind="record"
                                id={r.experiment_record_id}
                                identifier={t(
                                  'planner.campaign.openExperiment',
                                )}
                                mono={false}
                              />
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableBox>
              )}
            </Section>
            {selected ? (
              <RoundPanel
                key={selected.id}
                round={selected}
                campaign={campaign}
                canWrite={canWrite}
                onChanged={refresh}
              />
            ) : null}
          </>
        )}
      </div>
      {designing ? (
        <DesignDialog
          open
          onOpenChange={(o) => !o && setDesigning(false)}
          recordId={recordId}
          campaign={campaign}
          locked={locked}
        />
      ) : null}
      <Dialog open={finishing} onOpenChange={setFinishing}>
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader title={t('planner.campaign.finishTitle')} />
          <DialogBody>{t('planner.campaign.finishBody')}</DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="quiet" />}>
              {t('planner.dialog.cancel')}
            </DialogClose>
            <Button
              variant="primary"
              onClick={() => {
                setFinishing(false)
                setStatus.mutate('finished')
              }}
            >
              {t('planner.campaign.finish')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Best score so far after each round, as a small line. */
function Convergence({
  objectives,
  observations,
}: {
  objectives: Objective[]
  observations: Array<Observation & { round: number }>
}) {
  const scores = scoreObservations(objectives, observations)
  const roundsSeen = [...new Set(observations.map((o) => o.round))].sort(
    (a, b) => a - b,
  )
  const points = roundsSeen.map((round) => {
    let top = -Infinity
    observations.forEach((o, i) => {
      if (o.round <= round && scores[i] > top) top = scores[i]
    })
    return top
  })
  if (points.length < 2) return null
  const lo = Math.min(...points)
  const hi = Math.max(...points)
  const w = 320
  const h = 80
  const x = (i: number) => 8 + (i * (w - 16)) / (points.length - 1)
  const y = (v: number) =>
    h - 8 - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (h - 16)
  return (
    <figure className="m-0 mt-2">
      <svg
        role="img"
        aria-label={t('planner.campaign.convergenceLabel')}
        viewBox={`0 0 ${w} ${h}`}
        className="h-20 w-full max-w-sm text-link"
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          points={points.map((p, i) => `${x(i)},${y(p)}`).join(' ')}
        />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p)} r="3" fill="currentColor" />
        ))}
      </svg>
      <figcaption className="text-label text-fg-muted">
        {t('planner.campaign.convergence')}
      </figcaption>
    </figure>
  )
}

function RoundPanel({
  round,
  campaign,
  canWrite,
  onChanged,
}: {
  round: CampaignRoundRow
  campaign: CampaignRow
  canWrite: boolean
  onChanged: () => void
}) {
  const [entering, setEntering] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const fail = (fallback: string) => (e: unknown) =>
    toast.error(messageOf(e, fallback))

  const approve = useMutation({
    mutationFn: () => approveRound(client, round.id),
    onSuccess: () => {
      onChanged()
      toast.success(t('planner.campaign.approved'))
    },
    onError: fail(t('planner.campaign.couldNotDecide')),
  })
  const reject = useMutation({
    mutationFn: () => rejectRound(client, round.id),
    onSuccess: () => {
      onChanged()
      toast.success(t('planner.campaign.rejected'))
    },
    onError: fail(t('planner.campaign.couldNotDecide')),
  })
  const pull = useMutation({
    mutationFn: (key: string) => pullPlateResults(client, round.id, key),
    onSuccess: () => {
      onChanged()
      toast.success(t('planner.campaign.pulled'))
    },
    onError: fail(t('planner.campaign.couldNotPull')),
  })

  return (
    <Section
      title={t('planner.campaign.round', { number: round.number })}
      action={
        canWrite ? (
          <span className="flex flex-wrap gap-2">
            {round.status === 'proposed' ? (
              <>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={reject.isPending || approve.isPending}
                  onClick={() => setRejecting(true)}
                >
                  {t('planner.campaign.reject')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={approve.isPending || reject.isPending}
                  onClick={() => approve.mutate()}
                >
                  {approve.isPending
                    ? t('planner.campaign.approving')
                    : t('planner.campaign.approve')}
                </Button>
              </>
            ) : null}
            {round.status === 'approved' ? (
              <>
                {round.plate_run_id
                  ? campaign.objectives.slice(0, 1).map((o) => (
                      <Button
                        key={o.key}
                        size="sm"
                        disabled={pull.isPending}
                        onClick={() => pull.mutate(o.key)}
                      >
                        {t('planner.campaign.pullFromPlate')}
                      </Button>
                    ))
                  : null}
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setEntering(true)}
                >
                  {t('planner.campaign.enterResults')}
                </Button>
              </>
            ) : null}
          </span>
        ) : undefined
      }
    >
      {round.status === 'failed' ? (
        <Notice tone="bad" title={t('planner.campaign.failedTitle')}>
          {round.error_message}
        </Notice>
      ) : null}
      {round.status === 'proposed' ? (
        <p className="m-0 text-label text-fg-muted">
          {t('planner.campaign.approveHint')}
        </p>
      ) : null}
      {round.rationale.note ? (
        <p className="m-0 text-label text-fg-muted">
          <span className="font-medium text-fg">
            {t('planner.campaign.roundNote')}:{' '}
          </span>
          {round.rationale.note}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {round.experiment_record_id ? (
          <Button
            variant="quiet"
            size="sm"
            icon="file"
            nativeButton={false}
            render={
              <Link
                to="/experiments/$expId"
                params={{ expId: round.experiment_record_id }}
              />
            }
          >
            {t('planner.campaign.openExperiment')}
          </Button>
        ) : null}
        {round.plate_run_id ? (
          <Button
            variant="quiet"
            size="sm"
            icon="grid"
            nativeButton={false}
            render={<Link to="/plates" search={{ run: round.plate_run_id }} />}
          >
            {t('planner.campaign.openPlate')}
          </Button>
        ) : null}
      </div>
      {round.trials.length > 0 ? (
        <TableBox>
          <Table aria-label={t('planner.campaign.trialsTable')}>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t('planner.campaign.trialColumns.trial')}
                </TableHead>
                {campaign.factors.map((f) => (
                  <TableHead key={f.key}>{f.label}</TableHead>
                ))}
                {round.plate ? (
                  <TableHead>
                    {t('planner.campaign.trialColumns.wells')}
                  </TableHead>
                ) : null}
                {campaign.objectives.map((o) => (
                  <TableHead key={o.key}>{o.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {round.trials.map((trial) => (
                <TableRow key={trial.trial}>
                  <TableCell className="num">{trial.trial}</TableCell>
                  {campaign.factors.map((f) => (
                    <TableCell key={f.key} className="num">
                      {typeof trial.factors[f.key] === 'number'
                        ? fmt(trial.factors[f.key] as number)
                        : String(trial.factors[f.key] ?? '')}
                    </TableCell>
                  ))}
                  {round.plate ? (
                    <TableCell className="mono">
                      {(trial.wells ?? []).join(', ')}
                    </TableCell>
                  ) : null}
                  {campaign.objectives.map((o) => (
                    <TableCell key={o.key} className="num">
                      {typeof trial.results?.[o.key] === 'number'
                        ? fmt(trial.results[o.key])
                        : ''}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableBox>
      ) : null}
      {entering ? (
        <ResultsDialog
          round={round}
          campaign={campaign}
          onClose={() => setEntering(false)}
          onSaved={onChanged}
        />
      ) : null}
      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader title={t('planner.campaign.rejectTitle')} />
          <DialogBody>{t('planner.campaign.rejectBody')}</DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="quiet" />}>
              {t('planner.dialog.cancel')}
            </DialogClose>
            <Button
              variant="primary"
              onClick={() => {
                setRejecting(false)
                reject.mutate()
              }}
            >
              {t('planner.campaign.reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}

function ResultsDialog({
  round,
  campaign,
  onClose,
  onSaved,
}: {
  round: CampaignRoundRow
  campaign: CampaignRow
  onClose: () => void
  onSaved: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const trial of round.trials)
      for (const o of campaign.objectives) {
        const v = trial.results?.[o.key]
        if (typeof v === 'number') out[`${trial.trial}:${o.key}`] = String(v)
      }
    return out
  })
  const [problem, setProblem] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => {
      const results: Array<{ trial: number; results: Record<string, number> }> =
        []
      for (const trial of round.trials) {
        const row: Record<string, number> = {}
        for (const o of campaign.objectives) {
          const text = (values[`${trial.trial}:${o.key}`] ?? '').trim()
          if (text === '') continue
          const n = Number(text)
          if (!Number.isFinite(n))
            throw new Error(t('planner.campaign.resultsNumber'))
          row[o.key] = n
        }
        if (Object.keys(row).length > 0)
          results.push({ trial: trial.trial, results: row })
      }
      return recordResults(client, round.id, results)
    },
    onSuccess: (row) => {
      onSaved()
      toast.success(
        row.status === 'completed' && campaign.auto_propose
          ? t('planner.campaign.resultsSavedComplete')
          : row.status === 'completed'
            ? t('planner.campaign.resultsSavedDone')
            : t('planner.campaign.resultsSaved'),
      )
      onClose()
    },
    onError: (e: unknown) =>
      setProblem(messageOf(e, t('planner.campaign.couldNotSaveResults'))),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(640px,calc(100vw-32px))]">
        <DialogHeader
          title={t('planner.campaign.resultsTitle', { number: round.number })}
        />
        <DialogBody className="flex max-h-[65vh] flex-col gap-3 overflow-auto">
          <p className="m-0 text-label text-fg-muted">
            {t('planner.campaign.resultsHint')}
          </p>
          <TableBox>
            <Table aria-label={t('planner.campaign.trialsTable')}>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t('planner.campaign.trialColumns.trial')}
                  </TableHead>
                  {campaign.objectives.map((o) => (
                    <TableHead key={o.key}>{o.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {round.trials.map((trial) => (
                  <TableRow key={trial.trial}>
                    <TableCell className="num">{trial.trial}</TableCell>
                    {campaign.objectives.map((o) => (
                      <TableCell key={o.key}>
                        <Input
                          inputMode="decimal"
                          aria-label={`${o.label}, ${t('planner.campaign.trialColumns.trial')} ${trial.trial}`}
                          value={values[`${trial.trial}:${o.key}`] ?? ''}
                          onChange={(e) =>
                            setValues({
                              ...values,
                              [`${trial.trial}:${o.key}`]: e.target.value,
                            })
                          }
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
          {problem ? <Notice tone="bad">{problem}</Notice> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('planner.dialog.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() => {
              setProblem(null)
              save.mutate()
            }}
          >
            {save.isPending
              ? t('planner.campaign.savingResults')
              : t('planner.campaign.saveResults')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
