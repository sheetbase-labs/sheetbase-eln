import { useMemo, useState } from 'react'

import { Button } from '#/components/ui/button'
import { copyText } from '#/components/ui/copy-button'
import { Select } from '#/components/ui/select'
import { Spinner } from '#/components/ui/spinner'
import { Tabs } from '#/components/ui/tabs'
import {
  Table,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableBody,
} from '#/components/ui/table'
import { downloadTextFile } from '#/lib/download'
import { t } from '#/copy'
import { cn } from '#/lib/utils'
import { featureResidues, gcPercent, translate } from '#/lib/sequence'
import type { ParsedSequence, SequenceFeature } from '#/lib/sequence'
import { featureColour, featureLength, formatBases } from './geometry'
import { CircularMap, LinearMap } from './sequence-map'
import { useSequenceFile } from './use-sequence-file'

type View = 'circular' | 'linear'

/** The most bases that are laid out as letters at once. */
const READABLE_BASES = 400

function positionLabel(f: SequenceFeature): string {
  return f.start > f.end
    ? `${formatBases(f.start)}..${formatBases(f.end)} (${t('sequences.viewer.origin')})`
    : `${formatBases(f.start)}..${formatBases(f.end)}`
}

function fastaOf(seq: ParsedSequence): string {
  const lines = seq.residues.match(/.{1,70}/g) ?? []

  return `>${seq.name}${seq.description ? ` ${seq.description}` : ''}\n${lines.join('\n')}\n`
}

/** Open a stored GenBank or FASTA file as a map. */
export function SequenceFileViewer({
  fileRecordId,
  className,
}: {
  fileRecordId: string
  className?: string
}) {
  const query = useSequenceFile(fileRecordId)

  if (query.isPending)
    return (
      <p className="flex items-center gap-2 text-label text-fg-muted">
        <Spinner size={14} />
        {t('sequences.viewer.loading')}
      </p>
    )

  if (query.isError)
    return (
      <p role="alert" className="text-label text-danger">
        {t('sequences.viewer.failed', { message: query.error.message })}
      </p>
    )

  return <SequenceViewer sequences={query.data} className={className} />
}

/** The map, features and bases of one or more parsed sequences. */
export function SequenceViewer({
  sequences,
  className,
}: {
  sequences: readonly ParsedSequence[]
  className?: string
}) {
  const [index, setIndex] = useState(0)
  const seq = sequences[Math.min(index, sequences.length - 1)]

  return (
    <SequencePane
      // A different record starts from a fresh view.
      key={index}
      seq={seq}
      picker={
        sequences.length > 1 ? (
          <Select
            size="sm"
            aria-label={t('sequences.viewer.record')}
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
          >
            {sequences.map((s, i) => (
              // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- The picker's value is the record's position in the loaded list, so that position is its identity.
              <option key={i} value={i}>
                {s.name}
              </option>
            ))}
          </Select>
        ) : null
      }
      className={className}
    />
  )
}

function SequencePane({
  seq,
  picker,
  className,
}: {
  seq: ParsedSequence
  picker: React.ReactNode
  className?: string
}) {
  const canRing = seq.molecule !== 'protein' && seq.topology === 'circular'
  const [view, setView] = useState<View>(canRing ? 'circular' : 'linear')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(seq.length)
  const selected = seq.features.find((f) => f.id === selectedId) ?? null
  const span = to - from + 1

  const select = (id: number | null) => {
    setSelectedId(id)
    const f = seq.features.find((x) => x.id === id)

    if (
      f &&
      view === 'linear' &&
      f.start <= f.end &&
      (f.end < from || f.start > to)
    ) {
      const half = Math.floor(span / 2)
      const mid = Math.round((f.start + f.end) / 2)
      const start = Math.max(1, Math.min(seq.length - span + 1, mid - half))
      setFrom(start)
      setTo(start + span - 1)
    }
  }

  const zoom = (factor: number) => {
    const mid = (from + to) / 2
    const next = Math.min(seq.length, Math.max(20, Math.round(span * factor)))

    const start = Math.max(
      1,
      Math.min(seq.length - next + 1, Math.round(mid - next / 2)),
    )

    setFrom(start)
    setTo(Math.min(seq.length, start + next - 1))
  }

  const move = (start: number) => {
    const s = Math.max(1, Math.min(seq.length - span + 1, start))
    setFrom(s)
    setTo(s + span - 1)
  }

  const gc = seq.molecule === 'protein' ? null : gcPercent(seq.residues)

  const facts = [
    t(`sequences.summary.${seq.molecule}`),
    t(`sequences.summary.${seq.topology}`),
    t(`sequences.summary.length.${seq.molecule}`, { count: seq.length }),
    t('sequences.summary.features', { count: seq.features.length }),
    gc === null ? null : t('sequences.summary.gc', { value: gc }),
  ].filter((x): x is string => x !== null)

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {picker}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-body font-medium text-fg">
            {seq.name}
          </span>
          <span className="num text-label text-fg-muted">
            {facts.join(' · ')}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canRing ? (
            <Tabs
              mode="state"
              variant="segment"
              label={t('sequences.viewer.view')}
              value={view}
              onValueChange={(next) => {
                if (next === 'circular' || next === 'linear') setView(next)
              }}
              items={[
                { key: 'circular', label: t('sequences.viewer.circular') },
                { key: 'linear', label: t('sequences.viewer.linear') },
              ]}
            />
          ) : null}
          <Button
            size="sm"
            icon="copy"
            onClick={() =>
              void copyText(seq.residues, {
                copiedMessage: t('sequences.viewer.copied'),
              })
            }
          >
            {t('sequences.viewer.copySequence')}
          </Button>
          <Button
            size="sm"
            icon="download"
            onClick={() =>
              downloadTextFile(
                `${seq.name}.fasta`,
                fastaOf(seq),
                'text/x-fasta',
              )
            }
          >
            {t('sequences.viewer.downloadFasta')}
          </Button>
        </div>
      </div>
      {seq.description || seq.organism ? (
        <p className="text-label text-fg-muted">
          {[seq.description, seq.organism].filter(Boolean).join(' · ')}
        </p>
      ) : null}

      {/* react-doctor-disable-next-line react-doctor/duplicate-jsx-subtree -- The sequence-tools plugin ships its own standalone copy of this map card; the app cannot share a component across the package boundary. */}
      <div className="rounded-lg border border-border bg-surface p-3">
        {view === 'circular' ? (
          <div className="flex justify-center">
            <CircularMap
              sequence={seq}
              selectedId={selectedId}
              onSelect={select}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <LinearMap
              sequence={seq}
              selectedId={selectedId}
              onSelect={select}
              from={from}
              to={to}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                icon="plus"
                aria-label={t('sequences.viewer.zoomIn')}
                onClick={() => zoom(0.5)}
              />
              <Button
                size="sm"
                icon="minus"
                aria-label={t('sequences.viewer.zoomOut')}
                onClick={() => zoom(2)}
              />
              <Button
                size="sm"
                onClick={() => {
                  setFrom(1)
                  setTo(seq.length)
                }}
                disabled={span === seq.length}
              >
                {t('sequences.viewer.zoomReset')}
              </Button>
              <input
                type="range"
                aria-label={t('sequences.viewer.scroll')}
                className="min-w-32 flex-1 accent-[var(--primary)]"
                min={1}
                max={Math.max(1, seq.length - span + 1)}
                value={from}
                disabled={span >= seq.length}
                onChange={(e) => move(Number(e.target.value))}
              />
              <span className="num text-label text-fg-muted">
                {t('sequences.viewer.range', {
                  start: formatBases(from),
                  end: formatBases(to),
                })}
              </span>
            </div>
          </div>
        )}
      </div>

      {selected ? (
        <FeatureDetail
          seq={seq}
          feature={selected}
          onClear={() => select(null)}
        />
      ) : null}

      {view === 'linear' ? (
        <Bases seq={seq} from={from} to={to} selectedId={selectedId} />
      ) : null}

      <FeatureTable seq={seq} selectedId={selectedId} onSelect={select} />
    </div>
  )
}

function FeatureTable({
  seq,
  selectedId,
  onSelect,
}: {
  seq: ParsedSequence
  selectedId: number | null
  onSelect: (id: number | null) => void
}) {
  if (seq.features.length === 0)
    return (
      <p className="text-label text-fg-muted">
        {t('sequences.viewer.noFeatures')}
      </p>
    )
  const sorted = [...seq.features].sort((a, b) => a.start - b.start)

  return (
    // react-doctor-disable-next-line react-doctor/duplicate-jsx-subtree -- The sequence-tools plugin ships its own standalone copy of this table; the app cannot share a component across the package boundary.
    <TableBox>
      <Table caption={t('sequences.viewer.features')}>
        <TableHeader>
          <tr>
            <TableHead>{t('sequences.viewer.columns.name')}</TableHead>
            <TableHead>{t('sequences.viewer.columns.type')}</TableHead>
            <TableHead>{t('sequences.viewer.columns.position')}</TableHead>
            <TableHead align="right">
              {t('sequences.viewer.columns.length')}
            </TableHead>
            <TableHead>{t('sequences.viewer.columns.strand')}</TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {sorted.map((f) => (
            <TableRow key={f.id} selected={f.id === selectedId}>
              <TableCell>
                <button
                  type="button"
                  className="flex items-center gap-2 text-left text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                  aria-pressed={f.id === selectedId}
                  onClick={() => onSelect(f.id === selectedId ? null : f.id)}
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ background: featureColour(f.type) }}
                  />
                  <span className="max-w-64 truncate">{f.label}</span>
                </button>
              </TableCell>
              <TableCell className="text-fg-muted">{f.type}</TableCell>
              <TableCell className="num text-fg-muted">
                {positionLabel(f)}
              </TableCell>
              <TableCell align="right" className="num text-fg-muted">
                {formatBases(featureLength(f, seq.length))}
              </TableCell>
              <TableCell className="text-fg-muted">
                {f.strand === 1
                  ? t('sequences.viewer.strandForward')
                  : t('sequences.viewer.strandReverse')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableBox>
  )
}

const HIDDEN_QUALIFIERS = new Set(['translation', 'label'])

function FeatureDetail({
  seq,
  feature,
  onClear,
}: {
  seq: ParsedSequence
  feature: SequenceFeature
  onClear: () => void
}) {
  const residues = useMemo(
    () => featureResidues(seq.residues, feature.parts, feature.strand),
    [seq, feature],
  )

  const protein = useMemo(
    () =>
      feature.type === 'CDS' && seq.molecule !== 'protein'
        ? feature.qualifiers.translation || translate(residues)
        : null,
    [feature, residues, seq.molecule],
  )

  const qualifiers = Object.entries(feature.qualifiers).filter(
    ([k]) => !HIDDEN_QUALIFIERS.has(k),
  )

  return (
    // react-doctor-disable-next-line react-doctor/duplicate-jsx-subtree -- The sequence-tools plugin ships its own standalone copy of this panel; the app cannot share a component across the package boundary.
    <section
      aria-label={t('sequences.viewer.selected')}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden
          className="size-3 rounded-sm"
          style={{ background: featureColour(feature.type) }}
        />
        <h3 className="text-body font-medium">{feature.label}</h3>
        <span className="num text-label text-fg-muted">
          {feature.type} · {positionLabel(feature)} ·{' '}
          {t(`sequences.summary.length.${seq.molecule}`, {
            count: featureLength(feature, seq.length),
          })}
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            icon="copy"
            onClick={() =>
              void copyText(residues, {
                copiedMessage: t('sequences.viewer.copied'),
              })
            }
          >
            {t('sequences.viewer.copyFeature')}
          </Button>
          <Button size="sm" onClick={onClear}>
            {t('sequences.viewer.clear')}
          </Button>
        </div>
      </div>
      {qualifiers.length > 0 ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-label">
          {qualifiers.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-muted">{k.replace(/_/g, ' ')}</dt>
              <dd className="min-w-0 break-words text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {protein ? (
        <div className="flex flex-col gap-1">
          <span className="text-label text-fg-muted">
            {t('sequences.viewer.translation')}
          </span>
          <code className="num max-h-24 overflow-auto break-all rounded-md bg-surface-muted p-2 text-label">
            {protein}
          </code>
        </div>
      ) : null}
    </section>
  )
}

/** The bases of the visible window, with the features under them. */
function Bases({
  seq,
  from,
  to,
  selectedId,
}: {
  seq: ParsedSequence
  from: number
  to: number
  selectedId: number | null
}) {
  const span = to - from + 1
  const readable = span <= READABLE_BASES

  const rows = useMemo(() => {
    if (!readable) return []
    const owner: (SequenceFeature | undefined)[] = []

    for (const f of seq.features) {
      for (const p of f.parts) {
        const lo = Math.max(p.start, from)
        const hi = Math.min(p.end, to)

        for (let i = lo; i <= hi; i++) owner[i - from] ??= f
      }
    }

    const lines: {
      start: number
      cells: { ch: string; f?: SequenceFeature }[]
    }[] = []

    for (let i = 0; i < span; i += 60) {
      const cells = []

      for (let j = i; j < Math.min(span, i + 60); j++)
        cells.push({ ch: seq.residues[from - 1 + j] ?? '', f: owner[j] })
      lines.push({ start: from + i, cells })
    }

    return lines
  }, [seq, from, to, span, readable])

  return (
    // react-doctor-disable-next-line react-doctor/duplicate-jsx-subtree -- The sequence-tools plugin ships its own standalone copy of the base letters; the app cannot share a component across the package boundary.
    <section className="flex flex-col gap-1.5">
      <h3 className="text-section">{t('sequences.viewer.bases')}</h3>
      {readable ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface p-3 font-mono text-label leading-6">
          {rows.map((line) => (
            <div key={line.start} className="flex gap-3 whitespace-pre">
              <span className="num w-14 shrink-0 text-right text-fg-faint">
                {formatBases(line.start)}
              </span>
              <span>
                {line.cells.map((cell, i) => (
                  <span
                    key={i}
                    className={cn(
                      cell.f && 'rounded-[2px]',
                      i > 0 && i % 10 === 0 && 'ml-2',
                    )}
                    style={
                      cell.f
                        ? {
                            background: `color-mix(in srgb, ${featureColour(cell.f.type)} ${cell.f.id === selectedId ? 55 : 28}%, transparent)`,
                          }
                        : undefined
                    }
                  >
                    {cell.ch}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-label text-fg-muted">
          {t('sequences.viewer.zoomToRead', { count: READABLE_BASES })}
        </p>
      )}
    </section>
  )
}
