import { t } from '#/copy'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '#/components/ui/button'
import { CopyButton } from '#/components/ui/copy-button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { Tabs } from '#/components/ui/tabs'
import {
  convertTemperature,
  convertWithWeight,
  dilutionRecipe,
  solveDilution,
  solveMolarity,
} from '#/lib/calculators/calculators'
import type {
  CalcResult,
  DilutionTarget,
  MolarityTarget,
  Quantity,
  TempUnit,
} from '#/lib/calculators/calculators'
import { formatQuantity, unitById, unitsOfKind } from '#/lib/calculators/units'
import { useExtensionPoints } from '#/lib/extensions/use-extension-points'
import { PluginCalculatorPanel } from './plugin-calculator-panel'
import type { UnitKind } from '#/lib/calculators/units'

/** What "Insert into notebook" hands back: a metric block's payload. */
export interface CalculatorInsert {
  label: string
  value: number
  unit: string
  provenance: string
}

const TABS = ['molarity', 'dilution', 'convert', 'plugins'] as const

type Tab = (typeof TABS)[number]

/** The quantities the convert panel offers, including the two derived ones. */
const CONVERT_KINDS = [
  'mass',
  'volume',
  'concentration',
  'amount',
  'massMoles',
  'temperature',
] as const

/** The temperature scales the convert panel offers. */
const TEMPERATURE_UNITS: readonly TempUnit[] = ['C', 'F', 'K']

interface Answer {
  value: number
  unitLabel: string
  label: string
  workings: string
  note?: string
}

const toNumber = (raw: string) => (raw.trim() === '' ? NaN : Number(raw))

function QuantityInput({
  label,
  value,
  unit,
  kind,
  onChange,
}: {
  label: string
  value: string
  unit: string
  kind: UnitKind
  onChange: (value: string, unit: string) => void
}) {
  return (
    <div className="flex flex-col gap-1 text-label">
      <span className="font-medium text-fg">{label}</span>
      <div className="flex gap-2">
        <Input
          inputMode="decimal"
          value={value}
          aria-label={label}
          onChange={(e) => onChange(e.target.value, unit)}
        />
        <Select
          className="w-24 shrink-0"
          value={unit}
          aria-label={t('calculators.fields.unit')}
          onChange={(e) => onChange(value, e.target.value)}
        >
          {unitsOfKind(kind).map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
}

function SolveFor<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: readonly { id: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-col gap-1 text-label">
      <span className="font-medium text-fg">
        {t('calculators.fields.solveFor')}
      </span>
      <Select
        value={value}
        aria-label={t('calculators.fields.solveFor')}
        onChange={(e) =>
          onChange(options.find((o) => o.id === e.target.value)?.id ?? value)
        }
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  )
}

function q(value: string, unit: string): Quantity {
  return { value: toNumber(value), unit }
}

const fromResult = (r: CalcResult) => (r.ok ? r : null)

function MolarityPanel({ onAnswer }: { onAnswer: (a: Answer | null) => void }) {
  const [target, setTarget] = useState<MolarityTarget>('mass')
  const [mw, setMw] = useState('')
  const [mass, setMass] = useState({ v: '', u: 'mg' })
  const [volume, setVolume] = useState({ v: '', u: 'mL' })
  const [conc, setConc] = useState({ v: '', u: 'mM' })

  const result = useMemo(
    () =>
      solveMolarity({
        target,
        molecularWeight: toNumber(mw),
        mass: q(mass.v, mass.u),
        volume: q(volume.v, volume.u),
        concentration: q(conc.v, conc.u),
      }),
    [target, mw, mass, volume, conc],
  )

  const answer = useMemo(() => {
    const r = fromResult(result)

    if (!r) return null

    const part = (x: { v: string; u: string }) =>
      `${x.v} ${unitById(x.u).label}`

    const workings =
      target === 'mass'
        ? t('calculators.workings.molarity', {
            concentration: part(conc),
            volume: part(volume),
            weight: mw,
          })
        : `${mw} g/mol, ${target === 'volume' ? part(mass) + ', ' + part(conc) : part(mass) + ', ' + part(volume)}`

    return {
      value: r.value,
      unitLabel: unitById(r.unit).label,
      label: t(`calculators.molarity.${target}`),
      workings,
    }
  }, [result, target, mw, mass, volume, conc])

  // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent -- The computed answer is what the dialog previews and inserts, so it has to reach the dialog.
  // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent -- The answer is live calculation state, not a snapshot, and the dialog renders it beside the footer actions.
  // react-doctor-disable-next-line react-doctor/no-prop-callback-in-effect -- `onAnswer` is the dialog's store for this panel's answer, not a mirror of a prop; it is called only when the answer changes.
  useEffect(() => onAnswer(answer), [answer, onAnswer])

  return (
    <div className="grid gap-3">
      <SolveFor
        value={target}
        onChange={setTarget}
        options={[
          { id: 'mass', label: t('calculators.fields.mass') },
          { id: 'volume', label: t('calculators.fields.volume') },
          { id: 'concentration', label: t('calculators.fields.concentration') },
        ]}
      />
      <label className="flex flex-col gap-1 text-label">
        <span className="font-medium text-fg">
          {t('calculators.fields.molecularWeight')}
        </span>
        <Input
          inputMode="decimal"
          value={mw}
          onChange={(e) => setMw(e.target.value)}
        />
      </label>
      {target !== 'mass' ? (
        <QuantityInput
          label={t('calculators.fields.mass')}
          kind="mass"
          value={mass.v}
          unit={mass.u}
          onChange={(v, u) => setMass({ v, u })}
        />
      ) : null}
      {target !== 'volume' ? (
        <QuantityInput
          label={t('calculators.fields.volume')}
          kind="volume"
          value={volume.v}
          unit={volume.u}
          onChange={(v, u) => setVolume({ v, u })}
        />
      ) : null}
      {target !== 'concentration' ? (
        <QuantityInput
          label={t('calculators.fields.concentration')}
          kind="concentration"
          value={conc.v}
          unit={conc.u}
          onChange={(v, u) => setConc({ v, u })}
        />
      ) : null}
      <p className="text-label text-fg-muted">
        {t('calculators.molarity.hint')}
      </p>
      <Status result={result} />
    </div>
  )
}

function Status({ result }: { result: CalcResult }) {
  if (result.ok) return null

  return (
    <p className="text-label text-fg-muted" role="status">
      {result.reason === 'invalid'
        ? t('calculators.invalid')
        : t('calculators.needMore')}
    </p>
  )
}

function DilutionPanel({ onAnswer }: { onAnswer: (a: Answer | null) => void }) {
  const [target, setTarget] = useState<DilutionTarget>('v1')
  const [c1, setC1] = useState({ v: '', u: 'mM' })
  const [v1, setV1] = useState({ v: '', u: 'uL' })
  const [c2, setC2] = useState({ v: '', u: 'mM' })
  const [v2, setV2] = useState({ v: '', u: 'uL' })

  const result = useMemo(
    () =>
      solveDilution({
        target,
        c1: q(c1.v, c1.u),
        v1: q(v1.v, v1.u),
        c2: q(c2.v, c2.u),
        v2: q(v2.v, v2.u),
      }),
    [target, c1, v1, c2, v2],
  )

  const recipe = useMemo(() => {
    if (target !== 'v1') return null

    return dilutionRecipe({
      stock: q(c1.v, c1.u),
      target: q(c2.v, c2.u),
      finalVolume: q(v2.v, v2.u),
    })
  }, [target, c1, c2, v2])

  const answer = useMemo(() => {
    const r = fromResult(result)

    if (!r) return null

    const part = (x: { v: string; u: string }) =>
      `${x.v} ${unitById(x.u).label}`

    const parts = {
      c1: target === 'c1' ? '?' : part(c1),
      v1: target === 'v1' ? '?' : part(v1),
      c2: target === 'c2' ? '?' : part(c2),
      v2: target === 'v2' ? '?' : part(v2),
    }

    const recipeText =
      recipe && recipe.feasible
        ? t('calculators.dilution.recipe', {
            stock: `${formatQuantity(recipe.stock.value)} ${unitById(recipe.stock.unit).label}`,
            diluent: `${formatQuantity(recipe.diluent.value)} ${unitById(recipe.diluent.unit).label}`,
          })
        : undefined

    return {
      value: r.value,
      unitLabel: unitById(r.unit).label,
      label: t(`calculators.dilution.${target}`),
      workings: t('calculators.workings.dilution', parts),
      note: recipeText,
    }
  }, [result, target, c1, v1, c2, v2, recipe])

  // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent -- The computed answer is what the dialog previews and inserts, so it has to reach the dialog.
  // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent -- The answer is live calculation state, not a snapshot, and the dialog renders it beside the footer actions.
  // react-doctor-disable-next-line react-doctor/no-prop-callback-in-effect -- `onAnswer` is the dialog's store for this panel's answer, not a mirror of a prop; it is called only when the answer changes.
  useEffect(() => onAnswer(answer), [answer, onAnswer])

  const field = (
    id: DilutionTarget,
    label: string,
    kind: UnitKind,
    state: { v: string; u: string },
    set: (s: { v: string; u: string }) => void,
  ) =>
    target === id ? null : (
      <QuantityInput
        label={label}
        kind={kind}
        value={state.v}
        unit={state.u}
        onChange={(v, u) => set({ v, u })}
      />
    )

  return (
    <div className="grid gap-3">
      <SolveFor
        value={target}
        onChange={setTarget}
        options={[
          { id: 'v1', label: t('calculators.dilution.v1') },
          { id: 'c1', label: t('calculators.dilution.c1') },
          { id: 'c2', label: t('calculators.dilution.c2') },
          { id: 'v2', label: t('calculators.dilution.v2') },
        ]}
      />
      {field(
        'c1',
        t('calculators.fields.stockConcentration'),
        'concentration',
        c1,
        setC1,
      )}
      {field(
        'c2',
        t('calculators.fields.finalConcentration'),
        'concentration',
        c2,
        setC2,
      )}
      {field('v2', t('calculators.fields.finalVolume'), 'volume', v2, setV2)}
      {field('v1', t('calculators.fields.stockVolume'), 'volume', v1, setV1)}
      <p className="text-label text-fg-muted">
        {t('calculators.dilution.hint')}
      </p>
      {recipe && !recipe.feasible ? (
        <p className="text-label text-danger" role="status">
          {t('calculators.dilution.weakStock')}
        </p>
      ) : null}
      <Status result={result} />
    </div>
  )
}

type ConvertKind = UnitKind | 'massMoles' | 'temperature'

function ConvertPanel({ onAnswer }: { onAnswer: (a: Answer | null) => void }) {
  const [kind, setKind] = useState<ConvertKind>('mass')
  const [value, setValue] = useState('')
  const [from, setFrom] = useState('mg')
  const [to, setTo] = useState('ug')
  const [mw, setMw] = useState('')

  function changeKind(next: ConvertKind) {
    setKind(next)

    const defaults: Record<ConvertKind, [string, string]> = {
      mass: ['mg', 'ug'],
      volume: ['mL', 'uL'],
      concentration: ['mM', 'uM'],
      amount: ['mmol', 'umol'],
      massMoles: ['mg', 'umol'],
      temperature: ['C', 'F'],
    }

    setFrom(defaults[next][0])
    setTo(defaults[next][1])
  }

  const options = useMemo<{ id: string; label: string }[]>(
    () =>
      kind === 'temperature'
        ? [
            { id: 'C', label: '°C' },
            { id: 'F', label: '°F' },
            { id: 'K', label: 'K' },
          ]
        : (kind === 'massMoles'
            ? [...unitsOfKind('mass'), ...unitsOfKind('amount')]
            : unitsOfKind(kind)
          ).map((u) => ({ id: u.id, label: u.label })),
    [kind],
  )

  const result: CalcResult = useMemo(() => {
    const n = toNumber(value)

    if (!Number.isFinite(n)) return { ok: false, reason: 'missing' }

    if (kind === 'temperature') {
      return {
        ok: true,
        value: convertTemperature(
          n,
          TEMPERATURE_UNITS.find((unit) => unit === from) ?? 'C',
          TEMPERATURE_UNITS.find((unit) => unit === to) ?? 'C',
        ),
        unit: to,
        summary: 'temperature',
      }
    }

    return convertWithWeight({
      value: n,
      from,
      to,
      molecularWeight: toNumber(mw),
    })
  }, [kind, value, from, to, mw])

  const answer = useMemo(() => {
    const r = fromResult(result)

    if (!r) return null

    const labelOf = (id: string) =>
      options.find((o) => o.id === id)?.label ?? id

    return {
      value: r.value,
      unitLabel: labelOf(to),
      label: t('calculators.insertedLabel.convert'),
      workings: t('calculators.workings.convert', {
        value: `${value} ${labelOf(from)}`,
        unit: labelOf(to),
      }),
    }
  }, [result, value, from, to, options])

  // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent -- The computed answer is what the dialog previews and inserts, so it has to reach the dialog.
  // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent -- The answer is live calculation state, not a snapshot, and the dialog renders it beside the footer actions.
  // react-doctor-disable-next-line react-doctor/no-prop-callback-in-effect -- `onAnswer` is the dialog's store for this panel's answer, not a mirror of a prop; it is called only when the answer changes.
  useEffect(() => onAnswer(answer), [answer, onAnswer])

  const needsWeight =
    kind === 'massMoles' &&
    unitById(from).kind !== unitById(to).kind &&
    !(toNumber(mw) > 0)

  return (
    <div className="grid gap-3">
      <label className="flex flex-col gap-1 text-label">
        <span className="font-medium text-fg">
          {t('calculators.fields.quantity')}
        </span>
        <Select
          value={kind}
          aria-label={t('calculators.fields.quantity')}
          onChange={(e) =>
            changeKind(
              CONVERT_KINDS.find((candidate) => candidate === e.target.value) ??
                kind,
            )
          }
        >
          {(
            [
              'mass',
              'volume',
              'concentration',
              'amount',
              'massMoles',
              'temperature',
            ] as const
          ).map((k) => (
            <option key={k} value={k}>
              {t(`calculators.convert.${k}`)}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-label">
        <span className="font-medium text-fg">
          {t('calculators.fields.value')}
        </span>
        <Input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ['from', from, setFrom],
            ['to', to, setTo],
          ] as const
        ).map(([id, current, set]) => (
          <label key={id} className="flex flex-col gap-1 text-label">
            <span className="font-medium text-fg">
              {t(`calculators.fields.${id}`)}
            </span>
            <Select
              value={current}
              aria-label={t(`calculators.fields.${id}`)}
              onChange={(e) => set(e.target.value)}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>
      {kind === 'massMoles' ? (
        <label className="flex flex-col gap-1 text-label">
          <span className="font-medium text-fg">
            {t('calculators.fields.molecularWeight')}
          </span>
          <Input
            inputMode="decimal"
            value={mw}
            onChange={(e) => setMw(e.target.value)}
          />
        </label>
      ) : null}
      {needsWeight ? (
        <p className="text-label text-fg-muted" role="status">
          {t('calculators.convert.needsWeight')}
        </p>
      ) : (
        <Status result={result} />
      )}
    </div>
  )
}

/**
 * The bench calculators: molarity, C1V1 dilution and unit conversion. Used from
 * the notebook insert menu (where the answer can go in as a measured value with
 * its workings) and from sheets (where it is copied into a cell).
 */
export function BenchCalculatorDialog({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInsert?: (insert: CalculatorInsert) => void
}) {
  const [tab, setTab] = useState<Tab>('molarity')

  const [answers, setAnswers] = useState<Record<Tab, Answer | null>>({
    molarity: null,
    dilution: null,
    convert: null,
    plugins: null,
  })

  // Calculators that installed plugins add, as one more tab.
  const pluginCalculators = useExtensionPoints().operations.filter(
    (item) => item.point === 'calculators',
  )

  const answer = answers[tab]

  const setters = useMemo(
    () => ({
      molarity: (a: Answer | null) =>
        setAnswers((p) => (p.molarity === a ? p : { ...p, molarity: a })),
      dilution: (a: Answer | null) =>
        setAnswers((p) => (p.dilution === a ? p : { ...p, dilution: a })),
      convert: (a: Answer | null) =>
        setAnswers((p) => (p.convert === a ? p : { ...p, convert: a })),
      plugins: (a: Answer | null) =>
        setAnswers((p) => (p.plugins === a ? p : { ...p, plugins: a })),
    }),
    [],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('calculators.title')}
          description={t('calculators.description')}
        />
        <DialogBody>
          <Tabs
            mode="state"
            variant="segment"
            label={t('calculators.tabs.ariaLabel')}
            value={tab}
            onValueChange={(k) =>
              setTab(TABS.find((candidate) => candidate === k) ?? tab)
            }
            items={[
              { key: 'molarity', label: t('calculators.tabs.molarity') },
              { key: 'dilution', label: t('calculators.tabs.dilution') },
              { key: 'convert', label: t('calculators.tabs.convert') },
              ...(pluginCalculators.length > 0
                ? [{ key: 'plugins', label: t('calculators.tabs.plugins') }]
                : []),
            ]}
          />
          <div hidden={tab !== 'molarity'}>
            <MolarityPanel onAnswer={setters.molarity} />
          </div>
          <div hidden={tab !== 'dilution'}>
            <DilutionPanel onAnswer={setters.dilution} />
          </div>
          <div hidden={tab !== 'convert'}>
            <ConvertPanel onAnswer={setters.convert} />
          </div>
          {pluginCalculators.length > 0 ? (
            <div hidden={tab !== 'plugins'}>
              <PluginCalculatorPanel
                calculators={pluginCalculators}
                onAnswer={setters.plugins}
              />
            </div>
          ) : null}
          {answer ? (
            <div
              className="rounded-md border border-border bg-surface-muted/40 p-3"
              role="status"
              aria-label={t('calculators.result')}
            >
              <p className="text-label text-fg-muted">{answer.label}</p>
              <p className="text-2xl font-semibold tabular-nums text-fg">
                {formatQuantity(answer.value)} {answer.unitLabel}
              </p>
              {answer.note ? (
                <p className="mt-1 text-label text-fg-muted">{answer.note}</p>
              ) : null}
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.close')}
          </DialogClose>
          <CopyButton
            variant="secondary"
            disabled={!answer}
            value={() => (answer ? formatQuantity(answer.value) : '')}
            copiedMessage={t('calculators.copied')}
          >
            {t('calculators.copy')}
          </CopyButton>
          {onInsert ? (
            <Button
              variant="primary"
              disabled={!answer}
              onClick={() => {
                if (!answer) return
                onInsert({
                  label: answer.label,
                  value: Number(answer.value.toPrecision(6)),
                  unit: answer.unitLabel,
                  provenance: answer.workings,
                })
                onOpenChange(false)
              }}
            >
              {t('calculators.insert')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
