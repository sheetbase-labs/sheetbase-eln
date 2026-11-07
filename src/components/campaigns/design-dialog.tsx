/**
 * Edits a campaign's design: what it varies, what counts as better, how much it
 * may spend and how each round is laid out on a plate. Factors and objectives
 * lock once a round has been asked for.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import {
  CAMPAIGN_ENGINES,
  FACTOR_KINDS,
  OBJECTIVE_DIRECTIONS,
  designSchema,
} from '#/lib/campaigns/campaign'
import type {
  CampaignEngine,
  CampaignRow,
  Factor,
  Objective,
} from '#/lib/campaigns/campaign'
import { campaignKeys, configureCampaign } from '#/lib/campaigns/data'
import { isPlateFormat } from '#/lib/campaigns/layout'
import { notebookDataClient } from '#/lib/notebook-data'
import { FORMAT_DIMENSIONS } from '#/lib/plate-map'
import { WORKLIST_FORMATS } from '#/lib/plate-worklist'
import { messageOf } from '#/lib/result-quality'

const client = notebookDataClient

interface FactorDraft {
  label: string
  kind: Factor['kind']
  min: string
  max: string
  values: string
  unit: string
}
interface ObjectiveDraft {
  label: string
  direction: Objective['direction']
  target: string
  weight: string
  unit: string
}

const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]+/, '')
    .slice(0, 40)

const num = (text: string) => (text.trim() === '' ? NaN : Number(text))

function factorDraft(f?: Factor): FactorDraft {
  return {
    label: f?.label ?? '',
    kind: f?.kind ?? 'continuous',
    min: f?.min === undefined ? '' : String(f.min),
    max: f?.max === undefined ? '' : String(f.max),
    values: f?.values?.join(', ') ?? '',
    unit: f?.unit ?? '',
  }
}
function objectiveDraft(o?: Objective): ObjectiveDraft {
  return {
    label: o?.label ?? '',
    direction: o?.direction ?? 'maximise',
    target: o?.target === undefined ? '' : String(o.target),
    weight: o?.weight === undefined ? '' : String(o.weight),
    unit: o?.unit ?? '',
  }
}

/** The design the drafts describe, or the sentence saying what to fix. */
export function buildDesign(
  factors: FactorDraft[],
  objectives: ObjectiveDraft[],
): { factors: Factor[]; objectives: Objective[] } | { problem: string } {
  if (factors.length === 0)
    return { problem: t('planner.designDialog.needFactor') }
  if (objectives.length === 0)
    return { problem: t('planner.designDialog.needObjective') }
  const outFactors: Factor[] = []
  for (const d of factors) {
    const key = slug(d.label)
    if (!key) return { problem: t('planner.designDialog.nameProblem') }
    const base = {
      key,
      label: d.label.trim(),
      kind: d.kind,
      ...(d.unit.trim() ? { unit: d.unit.trim() } : {}),
    }
    if (d.kind === 'continuous') {
      const min = num(d.min)
      const max = num(d.max)
      if (!Number.isFinite(min) || !Number.isFinite(max))
        return {
          problem: t('planner.designDialog.numberProblem', { name: d.label }),
        }
      if (min >= max)
        return {
          problem: t('planner.designDialog.rangeProblem', { name: d.label }),
        }
      outFactors.push({ ...base, min, max })
    } else {
      const parts = d.values
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
      if (parts.length < 2)
        return {
          problem: t('planner.designDialog.valuesProblem', { name: d.label }),
        }
      const values = d.kind === 'discrete' ? parts.map((p) => Number(p)) : parts
      if (values.some((v) => typeof v === 'number' && !Number.isFinite(v)))
        return {
          problem: t('planner.designDialog.numberProblem', { name: d.label }),
        }
      outFactors.push({ ...base, values })
    }
  }
  const outObjectives: Objective[] = []
  for (const d of objectives) {
    const key = slug(d.label)
    if (!key) return { problem: t('planner.designDialog.nameProblem') }
    const weight = num(d.weight)
    const target = num(d.target)
    if (d.direction === 'target' && !Number.isFinite(target))
      return {
        problem: t('planner.designDialog.targetProblem', { name: d.label }),
      }
    if (d.weight.trim() !== '' && !(weight > 0))
      return {
        problem: t('planner.designDialog.numberProblem', { name: d.label }),
      }
    outObjectives.push({
      key,
      label: d.label.trim(),
      direction: d.direction,
      ...(d.direction === 'target' ? { target } : {}),
      ...(d.weight.trim() !== '' ? { weight } : {}),
      ...(d.unit.trim() ? { unit: d.unit.trim() } : {}),
    })
  }
  const parsed = designSchema.safeParse({
    factors: outFactors,
    objectives: outObjectives,
  })
  if (!parsed.success) {
    const dup = [...outFactors, ...outObjectives]
      .map((i) => i.key)
      .find((k, i, all) => all.indexOf(k) !== i)
    return {
      problem: dup
        ? t('planner.designDialog.duplicateName', { name: dup })
        : t('planner.designDialog.nameProblem'),
    }
  }
  return parsed.data
}

export function DesignDialog({
  open,
  onOpenChange,
  recordId,
  campaign,
  locked,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recordId: string
  campaign: CampaignRow | null
  /** A round has been asked for: the factors and objectives are fixed. */
  locked: boolean
}) {
  const queryClient = useQueryClient()
  const [factors, setFactors] = useState<FactorDraft[]>(() =>
    campaign?.factors.length
      ? campaign.factors.map((f) => factorDraft(f))
      : [factorDraft()],
  )
  const [objectives, setObjectives] = useState<ObjectiveDraft[]>(() =>
    campaign?.objectives.length
      ? campaign.objectives.map((o) => objectiveDraft(o))
      : [objectiveDraft()],
  )
  const layout = campaign?.layout ?? {}
  const [batchSize, setBatchSize] = useState(String(campaign?.batch_size ?? 8))
  const [maxRounds, setMaxRounds] = useState(String(campaign?.max_rounds ?? 5))
  const [maxRuns, setMaxRuns] = useState(
    campaign?.max_runs ? String(campaign.max_runs) : '',
  )
  const [plateFormat, setPlateFormat] = useState(layout.plateFormat ?? '')
  const [replicates, setReplicates] = useState(String(layout.replicates ?? 1))
  const [blanks, setBlanks] = useState(String(layout.blanks ?? 0))
  const [negatives, setNegatives] = useState(String(layout.negatives ?? 0))
  const [positives, setPositives] = useState(String(layout.positives ?? 0))
  const [volume, setVolume] = useState(
    layout.volumeUl ? String(layout.volumeUl) : '',
  )
  const [worklist, setWorklist] = useState(layout.worklistFormat ?? '')
  const [engine, setEngine] = useState<CampaignEngine>(
    campaign?.engine ?? 'auto',
  )
  const [templateId, setTemplateId] = useState(
    campaign?.template_record_id ?? '',
  )
  const [auto, setAuto] = useState(campaign?.auto_propose ?? false)
  const [problem, setProblem] = useState<string | null>(null)

  const protocols = useQuery({
    queryKey: ['campaigns', 'protocols'],
    queryFn: () =>
      client.list<{ id: string; identifier: string; title: string }>(
        'records',
        '?select=id,identifier,title&kind=eq.protocol_template&status=eq.active&deleted_at=is.null&order=title.asc&limit=100',
      ),
    enabled: open,
  })

  const save = useMutation({
    mutationFn: async () => {
      const design = buildDesign(factors, objectives)
      if ('problem' in design) throw new Error(design.problem)
      const n = (s: string, fallback: number) =>
        s.trim() === '' ? fallback : Number(s)
      return configureCampaign(client, recordId, {
        factors: design.factors,
        objectives: design.objectives,
        batchSize: n(batchSize, 8),
        maxRounds: n(maxRounds, 5),
        maxRuns: maxRuns.trim() === '' ? null : Number(maxRuns),
        engine,
        layout: plateFormat
          ? {
              plateFormat,
              replicates: n(replicates, 1),
              blanks: n(blanks, 0),
              negatives: n(negatives, 0),
              positives: n(positives, 0),
              ...(volume.trim() ? { volumeUl: Number(volume) } : {}),
              ...(worklist ? { worklistFormat: worklist } : {}),
            }
          : {},
        templateRecordId: templateId || null,
        autoPropose: auto,
        seed: campaign?.seed ?? Math.floor(Math.random() * 1_000_000),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: campaignKeys.all })
      toast.success(t('planner.designDialog.saved'))
      onOpenChange(false)
    },
    onError: (e: unknown) =>
      setProblem(messageOf(e, t('planner.designDialog.couldNotSave'))),
  })

  const update = <T,>(list: T[], i: number, patch: Partial<T>) =>
    list.map((item, at) => (at === i ? { ...item, ...patch } : item))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(720px,calc(100vw-32px))]">
        <DialogHeader title={t('planner.designDialog.title')} />
        <DialogBody className="flex max-h-[70vh] flex-col gap-5 overflow-auto">
          {locked ? (
            <Notice tone="info">{t('planner.campaign.designLocked')}</Notice>
          ) : null}
          <fieldset
            disabled={locked}
            className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
          >
            <legend className="mb-1 text-label font-medium">
              {t('planner.designDialog.factorsTitle')}
            </legend>
            {factors.map((f, i) => (
              <div
                key={i}
                className="grid grid-cols-2 items-end gap-2 md:grid-cols-[1.4fr_1fr_1fr_1fr_0.6fr_auto]"
              >
                <Field label={t('planner.designDialog.factorName')}>
                  <Input
                    value={f.label}
                    onChange={(e) =>
                      setFactors(update(factors, i, { label: e.target.value }))
                    }
                  />
                </Field>
                <Field label={t('planner.designDialog.factorKind')}>
                  <Select
                    value={f.kind}
                    onChange={(e) =>
                      setFactors(
                        update(factors, i, {
                          kind: e.target.value as Factor['kind'],
                        }),
                      )
                    }
                  >
                    {FACTOR_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`planner.campaign.kinds.${k}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {f.kind === 'continuous' ? (
                  <>
                    <Field label={t('planner.designDialog.factorMin')}>
                      <Input
                        inputMode="decimal"
                        value={f.min}
                        onChange={(e) =>
                          setFactors(
                            update(factors, i, { min: e.target.value }),
                          )
                        }
                      />
                    </Field>
                    <Field label={t('planner.designDialog.factorMax')}>
                      <Input
                        inputMode="decimal"
                        value={f.max}
                        onChange={(e) =>
                          setFactors(
                            update(factors, i, { max: e.target.value }),
                          )
                        }
                      />
                    </Field>
                  </>
                ) : (
                  <Field
                    className="col-span-2"
                    label={
                      f.kind === 'discrete'
                        ? t('planner.designDialog.factorValues')
                        : t('planner.designDialog.factorValuesChoices')
                    }
                  >
                    <Input
                      value={f.values}
                      onChange={(e) =>
                        setFactors(
                          update(factors, i, { values: e.target.value }),
                        )
                      }
                    />
                  </Field>
                )}
                <Field label={t('planner.designDialog.factorUnit')}>
                  <Input
                    value={f.unit}
                    onChange={(e) =>
                      setFactors(update(factors, i, { unit: e.target.value }))
                    }
                  />
                </Field>
                <Button
                  variant="quiet"
                  icon="trash"
                  aria-label={t('planner.designDialog.removeFactor', {
                    name: f.label || String(i + 1),
                  })}
                  onClick={() =>
                    setFactors(factors.filter((_, at) => at !== i))
                  }
                />
              </div>
            ))}
            <div>
              <Button
                size="sm"
                icon="plus"
                onClick={() => setFactors([...factors, factorDraft()])}
              >
                {t('planner.designDialog.addFactor')}
              </Button>
            </div>
          </fieldset>

          <fieldset
            disabled={locked}
            className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
          >
            <legend className="mb-1 text-label font-medium">
              {t('planner.designDialog.objectivesTitle')}
            </legend>
            {objectives.map((o, i) => (
              <div
                key={i}
                className="grid grid-cols-2 items-end gap-2 md:grid-cols-[1.4fr_1fr_1fr_0.8fr_0.6fr_auto]"
              >
                <Field label={t('planner.designDialog.objectiveName')}>
                  <Input
                    value={o.label}
                    onChange={(e) =>
                      setObjectives(
                        update(objectives, i, { label: e.target.value }),
                      )
                    }
                  />
                </Field>
                <Field label={t('planner.designDialog.objectiveGoal')}>
                  <Select
                    value={o.direction}
                    onChange={(e) =>
                      setObjectives(
                        update(objectives, i, {
                          direction: e.target.value as Objective['direction'],
                        }),
                      )
                    }
                  >
                    {OBJECTIVE_DIRECTIONS.map((d) => (
                      <option key={d} value={d}>
                        {t(`planner.campaign.directions.${d}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('planner.designDialog.objectiveTarget')}>
                  <Input
                    inputMode="decimal"
                    disabled={o.direction !== 'target'}
                    value={o.target}
                    onChange={(e) =>
                      setObjectives(
                        update(objectives, i, { target: e.target.value }),
                      )
                    }
                  />
                </Field>
                <Field label={t('planner.designDialog.objectiveWeight')}>
                  <Input
                    inputMode="decimal"
                    value={o.weight}
                    onChange={(e) =>
                      setObjectives(
                        update(objectives, i, { weight: e.target.value }),
                      )
                    }
                  />
                </Field>
                <Field label={t('planner.designDialog.objectiveUnit')}>
                  <Input
                    value={o.unit}
                    onChange={(e) =>
                      setObjectives(
                        update(objectives, i, { unit: e.target.value }),
                      )
                    }
                  />
                </Field>
                <Button
                  variant="quiet"
                  icon="trash"
                  aria-label={t('planner.designDialog.removeObjective', {
                    name: o.label || String(i + 1),
                  })}
                  onClick={() =>
                    setObjectives(objectives.filter((_, at) => at !== i))
                  }
                />
              </div>
            ))}
            <div>
              <Button
                size="sm"
                icon="plus"
                disabled={objectives.length >= 4}
                onClick={() => setObjectives([...objectives, objectiveDraft()])}
              >
                {t('planner.designDialog.addObjective')}
              </Button>
            </div>
          </fieldset>

          <fieldset className="m-0 grid min-w-0 grid-cols-2 gap-2 border-0 p-0 md:grid-cols-3">
            <legend className="mb-1 text-label font-medium">
              {t('planner.designDialog.budgetTitle')}
            </legend>
            <Field label={t('planner.designDialog.batchSize')}>
              <Input
                inputMode="numeric"
                value={batchSize}
                onChange={(e) => setBatchSize(e.target.value)}
              />
            </Field>
            <Field label={t('planner.designDialog.maxRounds')}>
              <Input
                inputMode="numeric"
                value={maxRounds}
                onChange={(e) => setMaxRounds(e.target.value)}
              />
            </Field>
            <Field label={t('planner.designDialog.maxRuns')}>
              <Input
                inputMode="numeric"
                value={maxRuns}
                onChange={(e) => setMaxRuns(e.target.value)}
              />
            </Field>
          </fieldset>

          <fieldset className="m-0 grid min-w-0 grid-cols-2 gap-2 border-0 p-0 md:grid-cols-3">
            <legend className="mb-1 text-label font-medium">
              {t('planner.designDialog.plateTitle')}
            </legend>
            <Field label={t('planner.designDialog.plateFormat')}>
              <Select
                value={plateFormat}
                onChange={(e) => setPlateFormat(e.target.value)}
              >
                <option value="">{t('planner.designDialog.plateNone')}</option>
                {Object.keys(FORMAT_DIMENSIONS)
                  .filter(isPlateFormat)
                  .map((f) => (
                    <option key={f} value={f}>
                      {f.replace('_well', '-well')}
                    </option>
                  ))}
              </Select>
            </Field>
            {plateFormat ? (
              <>
                <Field label={t('planner.designDialog.replicates')}>
                  <Input
                    inputMode="numeric"
                    value={replicates}
                    onChange={(e) => setReplicates(e.target.value)}
                  />
                </Field>
                <Field label={t('planner.designDialog.volume')}>
                  <Input
                    inputMode="decimal"
                    value={volume}
                    onChange={(e) => setVolume(e.target.value)}
                  />
                </Field>
                <Field label={t('planner.designDialog.blanks')}>
                  <Input
                    inputMode="numeric"
                    value={blanks}
                    onChange={(e) => setBlanks(e.target.value)}
                  />
                </Field>
                <Field label={t('planner.designDialog.negatives')}>
                  <Input
                    inputMode="numeric"
                    value={negatives}
                    onChange={(e) => setNegatives(e.target.value)}
                  />
                </Field>
                <Field label={t('planner.designDialog.positives')}>
                  <Input
                    inputMode="numeric"
                    value={positives}
                    onChange={(e) => setPositives(e.target.value)}
                  />
                </Field>
                <Field
                  className="col-span-2 md:col-span-3"
                  label={t('planner.designDialog.worklist')}
                  hint={t('planner.designDialog.worklistHint')}
                >
                  <Select
                    value={worklist}
                    onChange={(e) => setWorklist(e.target.value)}
                  >
                    <option value="">
                      {t('planner.designDialog.worklistNone')}
                    </option>
                    {WORKLIST_FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {t(`planner.designDialog.worklistFormats.${f}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            ) : null}
          </fieldset>

          <fieldset className="m-0 grid min-w-0 grid-cols-1 gap-2 border-0 p-0 md:grid-cols-2">
            <legend className="mb-1 text-label font-medium">
              {t('planner.designDialog.otherTitle')}
            </legend>
            <Field
              label={t('planner.designDialog.engine')}
              hint={t('planner.designDialog.engineHint')}
            >
              <Select
                value={engine}
                onChange={(e) => setEngine(e.target.value as CampaignEngine)}
              >
                {CAMPAIGN_ENGINES.map((e) => (
                  <option key={e} value={e}>
                    {t(`planner.campaign.engines.${e}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('planner.designDialog.protocol')}>
              <Select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="">
                  {t('planner.designDialog.protocolNone')}
                </option>
                {(protocols.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.identifier} {p.title}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-label md:col-span-2">
              <Checkbox
                checked={auto}
                onCheckedChange={(v) => setAuto(v === true)}
              />
              {t('planner.designDialog.autoPropose')}
            </label>
          </fieldset>
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
              ? t('planner.designDialog.saving')
              : t('planner.designDialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
