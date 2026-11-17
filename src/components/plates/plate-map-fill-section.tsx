/**
 * Lay the experiment's samples out on the plate. The plate map is written for
 * you (standards and blanks down the first columns, then the samples in order),
 * so each well is a sample of the experiment and its result can reach that
 * sample. You can still edit the layout by hand afterwards.
 */
import { useState } from 'react'

import { Button } from '#/components/ui/button'
import { ObjectLink } from '#/components/ui/object-link'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { t } from '#/copy'
import type { AssayMethod } from '#/lib/plate-assay'
import { fillPlate } from '#/lib/plate-map-fill'
import type { StandardsSpec } from '#/lib/plate-map-fill'
import type { PlateFormat } from '#/lib/plate-map'

import type { ExperimentSample } from './use-experiment-samples'

const numberOr = (value: string, fallback: number) => {
  const n = Number(value)

  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function PlateMapFillSection({
  samples,
  method,
  dilution,
  format,
  onFill,
}: {
  samples: readonly ExperimentSample[]
  method: AssayMethod
  /** How far the samples are diluted, from the assay's setup. */
  dilution: number
  format: PlateFormat
  onFill: (layoutText: string) => void
}) {
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set())
  const [replicates, setReplicates] = useState('2')
  const [direction, setDirection] = useState<'across' | 'down'>('across')
  const [top, setTop] = useState('1000')
  const [unit, setUnit] = useState('ng/mL')
  const [fold, setFold] = useState('2')
  const [points, setPoints] = useState('7')
  const [standardReplicates, setStandardReplicates] = useState('2')
  const [blanks, setBlanks] = useState('2')
  const [leftOut, setLeftOut] = useState<string[]>([])

  const chosen = samples.filter((s) => !unticked.has(s.identifier))
  const quantify = method === 'quantify'

  function fill() {
    const standards: StandardsSpec | null = quantify
      ? {
          top: numberOr(top, 1000),
          unit,
          fold: Math.max(1.1, numberOr(fold, 2)),
          points: numberOr(points, 7),
          replicates: numberOr(standardReplicates, 2),
        }
      : null

    const result = fillPlate({
      format,
      samples: chosen.map((s) => s.identifier),
      replicates: numberOr(replicates, 1),
      direction,
      dilution,
      standards,
      blanks: quantify ? Math.floor(Number(blanks)) || 0 : 0,
    })

    setLeftOut(result.left)
    onFill(result.text)
  }

  return (
    <div className="flex flex-col gap-3" data-testid="plate-map-fill">
      <div className="flex flex-col gap-0.5">
        <div className="font-medium text-fg">
          {t('features.plateRuns.fill.title')}
        </div>
        <div className="text-label text-fg-muted">
          {t('features.plateRuns.fill.hint', { count: samples.length })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
        {samples.map((sample) => (
          <div
            key={sample.identifier}
            className="flex items-center gap-2 text-label"
          >
            <Checkbox
              checked={!unticked.has(sample.identifier)}
              onCheckedChange={(checked) =>
                setUnticked((current) => {
                  const next = new Set(current)

                  if (checked === true) next.delete(sample.identifier)
                  else next.add(sample.identifier)

                  return next
                })
              }
            />
            {sample.id ? (
              <ObjectLink kind="sample" id={sample.id}>
                {sample.identifier}
              </ObjectLink>
            ) : (
              <span>{sample.identifier}</span>
            )}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label={t('features.plateRuns.fill.replicates')}>
          <Select
            value={replicates}
            onChange={(e) => setReplicates(e.target.value)}
          >
            {['1', '2', '3', '4'].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('features.plateRuns.fill.direction')}>
          <Select
            value={direction}
            onChange={(e) =>
              setDirection(e.target.value === 'down' ? 'down' : 'across')
            }
          >
            <option value="across">
              {t('features.plateRuns.fill.across')}
            </option>
            <option value="down">{t('features.plateRuns.fill.down')}</option>
          </Select>
        </Field>
        {quantify ? (
          <Field label={t('features.plateRuns.fill.blanks')}>
            <Select value={blanks} onChange={(e) => setBlanks(e.target.value)}>
              {['0', '1', '2', '3', '4'].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      {quantify ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label={t('features.plateRuns.fill.top')}>
            <Input
              type="number"
              min={0}
              step="any"
              value={top}
              onChange={(e) => setTop(e.target.value)}
            />
          </Field>
          <Field label={t('features.plateRuns.fill.unit')}>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
          <Field label={t('features.plateRuns.fill.fold')}>
            <Input
              type="number"
              min={1.1}
              step="any"
              value={fold}
              onChange={(e) => setFold(e.target.value)}
            />
          </Field>
          <Field label={t('features.plateRuns.fill.points')}>
            <Select value={points} onChange={(e) => setPoints(e.target.value)}>
              {['5', '6', '7', '8'].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('features.plateRuns.fill.standardReplicates')}>
            <Select
              value={standardReplicates}
              onChange={(e) => setStandardReplicates(e.target.value)}
            >
              {['1', '2', '3'].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        <Button disabled={chosen.length === 0} onClick={fill}>
          {t('features.plateRuns.fill.fill', { count: chosen.length })}
        </Button>
        {leftOut.length > 0 ? (
          <span className="text-label text-warning-text">
            {t('features.plateRuns.fill.left', {
              count: leftOut.length,
              first: leftOut[0],
            })}
          </span>
        ) : null}
      </div>
    </div>
  )
}
