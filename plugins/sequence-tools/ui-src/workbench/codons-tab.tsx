/**
 * Codon optimisation: re-write a coding region for a host, keeping the protein.
 */
import { useRef, useState } from 'react'

import {
  Button,
  Checkbox,
  Field,
  Input,
  Notice,
  Select,
  toast,
} from '../ui/kit'
import { t } from '#/copy'
import {
  COMMON_ENZYMES,
  HOSTS,
  optimiseCodons,
  reverseComplement,
} from '#/lib/molbio'
import type { CodonResult, Host } from '#/lib/molbio'
import { fixed, Panel } from './shared'
import type { WorkbenchProps } from './shared'

function numberOr(text: string, fallback: number): number {
  const n = Number.parseInt(text, 10)

  return Number.isFinite(n) ? n : fallback
}

export function CodonsTab({ draft, insertBelow, canEdit }: WorkbenchProps) {
  const len = draft.residues.length
  const cds = draft.features.find((f) => f.type === 'CDS' && f.start <= f.end)
  const [host, setHost] = useState<Host>('ecoli')
  const [from, setFrom] = useState(String(cds?.start ?? 1))
  const [to, setTo] = useState(String(cds?.end ?? len))
  const reverse = useRef(cds?.strand === -1)
  const [avoid, setAvoid] = useState(true)
  const [result, setResult] = useState<CodonResult | null>(null)

  if (draft.molecule === 'protein')
    return <Notice>{t('molbio.enzymes.dnaOnly')}</Notice>

  if (len === 0) return <Notice>{t('molbio.enzymes.empty')}</Notice>

  const run = () => {
    const start = Math.max(1, Math.min(len, numberOr(from, 1)))
    const end = Math.max(start, Math.min(len, numberOr(to, len)))
    const top = draft.residues.slice(start - 1, end).toUpperCase()
    // A feature on the bottom strand is read from its reverse complement.
    const region = reverse.current ? reverseComplement(top) : top

    if (region.length % 3 !== 0 || /[^ACGT]/.test(region)) {
      toast.error(t('molbio.codons.notWhole'))

      return
    }

    const map = draft.mapEnzymes ?? [...COMMON_ENZYMES]
    setResult(
      optimiseCodons({ dna: region }, { host, avoidEnzymes: avoid ? map : [] }),
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title={t('molbio.codons.title')} hint={t('molbio.codons.hint')}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('molbio.codons.host')} className="w-44">
            <Select
              value={host}
              onChange={(e) => {
                const selected = HOSTS.find((h) => h.key === e.target.value)

                if (selected) setHost(selected.key)
              }}
            >
              {HOSTS.map((h) => (
                <option key={h.key} value={h.key}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('molbio.codons.from')} className="w-28">
            <Input
              inputMode="numeric"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label={t('molbio.codons.to')} className="w-28">
            <Input
              inputMode="numeric"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          {draft.features.some((f) => f.type === 'CDS' && f.start <= f.end) ? (
            <Field label={t('molbio.codons.fromFeature')} className="w-48">
              <Select
                value=""
                onChange={(e) => {
                  const ft = draft.features.find(
                    (x) => String(x.id) === e.target.value,
                  )

                  if (ft) {
                    setFrom(String(ft.start))
                    setTo(String(ft.end))
                    reverse.current = ft.strand === -1
                  }
                }}
              >
                <option value="">{t('molbio.codons.pickFeature')}</option>
                {draft.features
                  .filter((x) => x.type === 'CDS' && x.start <= x.end)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : null}
          <label className="flex items-center gap-2 pb-1 text-label">
            <Checkbox checked={avoid} onCheckedChange={setAvoid} />
            {t('molbio.codons.avoid')}
          </label>
          <Button variant="primary" icon="spark" onClick={run}>
            {t('molbio.codons.run')}
          </Button>
        </div>
      </Panel>
      {result ? (
        <Panel title={t('molbio.codons.result')}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-body sm:grid-cols-4">
            <div>
              <dt className="text-label text-fg-muted">
                {t('molbio.codons.before')}
              </dt>
              <dd className="num">{fixed(result.caiBefore ?? 0, 2)}</dd>
            </div>
            <div>
              <dt className="text-label text-fg-muted">
                {t('molbio.codons.after')}
              </dt>
              <dd className="num">{fixed(result.caiAfter, 2)}</dd>
            </div>
            <div>
              <dt className="text-label text-fg-muted">
                {t('molbio.codons.gc')}
              </dt>
              <dd className="num">{Math.round(result.gc * 100)}%</dd>
            </div>
            <div>
              <dt className="text-label text-fg-muted">
                {t('molbio.codons.changed')}
              </dt>
              <dd className="num">{result.changed}</dd>
            </div>
          </dl>
          {result.unresolved.length > 0 ? (
            <Notice>
              {t('molbio.codons.unresolved')}: {result.unresolved.join(', ')}
            </Notice>
          ) : null}
          <pre className="max-h-48 overflow-auto rounded-md border border-border p-2 font-mono text-label break-all whitespace-pre-wrap">
            {result.dna}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button
              icon="copy"
              onClick={() => {
                void navigator.clipboard
                  .writeText(result.dna)
                  .then(() => toast(t('molbio.codons.copied')))
              }}
            >
              {t('molbio.codons.copy')}
            </Button>
            {canEdit && insertBelow ? (
              <Button
                onClick={() =>
                  insertBelow({
                    name: t('molbio.codons.resultName', {
                      name: draft.name || draft.title || '',
                    }),
                    molecule: 'dna',
                    topology: 'linear',
                    residues: result.dna,
                    features: [],
                  })
                }
              >
                {t('molbio.codons.addBelow')}
              </Button>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </div>
  )
}
