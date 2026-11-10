/**
 * Sanger reads: add .ab1 trace files, check each against the sequence you
 * meant to make, and see exactly where they differ and how well they read.
 */
import { useMemo, useRef, useState } from 'react'

import { Button, IconButton, Notice, Select, toast } from '../ui/kit'
import { t } from '#/copy'
import {
  checkRead,
  coverageOf,
  isAbifFileName,
  packTrace,
  parseAbif,
  readFromStored,
} from '#/lib/molbio'
import type { ReadCheck, ReadVerdict } from '#/lib/molbio'
import { MAX_READS, storedRead } from '#/lib/sequence-block'
import type { StoredRead } from '#/lib/sequence-block'
import { cn } from '#/lib/utils'
import { Chromatogram } from './chromatogram'
import { DataTable, Panel, fixed } from './shared'
import type { WorkbenchProps } from './shared'

const VERDICT_STYLE: Record<ReadVerdict, string> = {
  matches: 'bg-success-wash text-success-text',
  review: 'bg-warning-wash text-warning-text',
  mismatch: 'bg-danger-wash text-danger-text',
  noAlignment: 'bg-surface-muted text-fg-muted',
}

const NO_READS: readonly StoredRead[] = []

export function VerdictBadge({ verdict }: { verdict: ReadVerdict }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-sm px-1.5 py-0.5 text-label font-medium',
        VERDICT_STYLE[verdict],
      )}
    >
      {t(`molbio.reads.verdict.${verdict}`)}
    </span>
  )
}

/** Check every stored read against the sequence. */
export function checkReads(
  residues: string,
  topology: 'linear' | 'circular',
  features: WorkbenchProps['draft']['features'],
  reads: readonly StoredRead[],
): Map<string, ReadCheck> {
  const out = new Map<string, ReadCheck>()

  for (const r of reads)
    out.set(
      r.id,
      checkRead(residues.toUpperCase(), topology, features, readFromStored(r)),
    )

  return out
}

/** Read files in selection order so the limit counts only successful imports. */
async function importReads(files: FileList, existingCount: number) {
  const added: StoredRead[] = []

  for (const file of Array.from(files)) {
    if (existingCount + added.length >= MAX_READS) {
      toast.error(t('molbio.reads.tooMany', { count: MAX_READS }))
      break
    }

    if (!isAbifFileName(file.name)) {
      toast.error(t('molbio.reads.notTrace', { name: file.name }))
      continue
    }

    try {
      // eslint-disable-next-line react-doctor/async-await-in-loop -- Successful reads count toward the limit and failures must remain ordered.
      const trace = parseAbif(await file.arrayBuffer())
      added.push(
        storedRead(
          trace.name || file.name.replace(/\.[^.]+$/, ''),
          trace.bases,
          trace.quality,
          packTrace(trace),
        ),
      )
    } catch (e) {
      toast.error(
        t('molbio.reads.failed', {
          name: file.name,
          message: e instanceof Error ? e.message : '',
        }),
      )
    }
  }

  return added
}

export function ReadsTab({ draft, edit, canEdit }: WorkbenchProps) {
  const reads = draft.reads ?? NO_READS
  const { residues, topology, features } = draft
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const [regionId, setRegionId] = useState('')

  const checks = useMemo(
    () => checkReads(residues, topology, features, reads),
    [residues, topology, features, reads],
  )

  if (draft.molecule === 'protein')
    return <Notice>{t('molbio.enzymes.dnaOnly')}</Notice>

  if (draft.residues.length === 0)
    return <Notice>{t('molbio.enzymes.empty')}</Notice>
  const selected = reads.find((r) => r.id === selectedId) ?? reads.at(0)
  const check = selected ? checks.get(selected.id) : undefined
  const region = draft.features.find((f) => String(f.id) === regionId)

  const regionSpan =
    region && region.start <= region.end
      ? { start: region.start, end: region.end }
      : { start: 1, end: draft.residues.length }

  const coverage = coverageOf(
    [...checks.values()].filter((c) => c.verdict !== 'noAlignment'),
    regionSpan,
  )

  const add = async (files: FileList) => {
    setBusy(true)

    try {
      const added = await importReads(files, reads.length)

      if (added.length > 0) {
        edit((d) => ({ ...d, reads: [...(d.reads ?? []), ...added] }))
        setSelectedId(added[0].id)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title={t('molbio.reads.title', { count: reads.length })}
        hint={t('molbio.reads.hint')}
        actions={
          canEdit ? (
            <>
              <Button
                size="sm"
                icon="upload"
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                {busy ? t('molbio.reads.adding') : t('molbio.reads.add')}
              </Button>
              <input
                ref={input}
                type="file"
                hidden
                multiple
                accept=".ab1,.abi"
                onChange={(e) => {
                  const files = e.target.files

                  if (files && files.length > 0) void add(files)
                  e.target.value = ''
                }}
              />
            </>
          ) : null
        }
      >
        <DataTable
          caption={t('molbio.reads.caption')}
          rows={reads}
          rowKey={(r) => r.id}
          selectedKey={selected?.id}
          empty={t('molbio.reads.none')}
          columns={[
            {
              key: 'name',
              head: t('molbio.reads.columns.read'),
              cell: (r) => (
                <button
                  type="button"
                  className="font-medium text-fg hover:underline"
                  onClick={() => {
                    setSelectedId(r.id)
                    setFocus(null)
                  }}
                >
                  {r.name}
                </button>
              ),
            },
            {
              key: 'verdict',
              head: t('molbio.reads.columns.verdict'),
              cell: (r) => (
                <VerdictBadge
                  verdict={checks.get(r.id)?.verdict ?? 'noAlignment'}
                />
              ),
            },
            {
              key: 'strand',
              head: t('molbio.reads.columns.strand'),
              cell: (r) => {
                const s = checks.get(r.id)?.strand

                return s === 1
                  ? t('sequences.viewer.strandForward')
                  : s === -1
                    ? t('sequences.viewer.strandReverse')
                    : '—'
              },
            },
            {
              key: 'covers',
              head: t('molbio.reads.columns.covers'),
              cell: (r) => {
                const c = checks.get(r.id)?.covers

                return c ? `${c.start}..${c.end}` : '—'
              },
            },
            {
              key: 'identity',
              head: t('molbio.reads.columns.identity'),
              align: 'right',
              cell: (r) => {
                const c = checks.get(r.id)

                return c && c.verdict !== 'noAlignment'
                  ? `${fixed(c.identity * 100, 2)}%`
                  : '—'
              },
            },
            {
              key: 'quality',
              head: t('molbio.reads.columns.quality'),
              align: 'right',
              cell: (r) => fixed(checks.get(r.id)?.meanQuality ?? 0),
            },
            {
              key: 'diffs',
              head: t('molbio.reads.columns.differences'),
              align: 'right',
              cell: (r) => checks.get(r.id)?.differences.length ?? 0,
            },
            ...(canEdit
              ? [
                  {
                    key: 'x',
                    head: '',
                    align: 'right' as const,
                    cell: (r: StoredRead) => (
                      <IconButton
                        label={t('molbio.reads.remove')}
                        icon="x"
                        onClick={() =>
                          edit((d) => ({
                            ...d,
                            reads: (d.reads ?? []).filter((x) => x.id !== r.id),
                          }))
                        }
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Panel>

      {reads.length > 0
        ? coveragePanel(draft, regionId, setRegionId, regionSpan, coverage)
        : null}

      {selected && check ? readDetails(selected, check, focus, setFocus) : null}
    </div>
  )
}

/** Build coverage controls without deferring access to the features list. */
function coveragePanel(
  draft: WorkbenchProps['draft'],
  regionId: string,
  setRegionId: (id: string) => void,
  regionSpan: { start: number; end: number },
  coverage: number,
) {
  return (
    <Panel
      title={t('molbio.reads.coverage')}
      actions={
        draft.features.length > 0 ? (
          <Select
            size="sm"
            aria-label={t('molbio.reads.region')}
            value={regionId}
            onChange={(e) => setRegionId(e.target.value)}
          >
            <option value="">{t('molbio.reads.wholeSequence')}</option>
            {draft.features
              .filter((f) => f.start <= f.end)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
          </Select>
        ) : null
      }
    >
      <p className="num text-body text-fg">
        {t('molbio.reads.coverageValue', {
          percent: fixed(coverage * 100, 0),
          from: regionSpan.start,
          to: regionSpan.end,
        })}
      </p>
    </Panel>
  )
}

/** Build the selected-read panel at its original position in the render. */
function readDetails(
  selected: StoredRead,
  check: ReadCheck,
  focus: number | null,
  setFocus: (focus: number) => void,
) {
  return (
    <Panel title={t('molbio.reads.details', { name: selected.name })}>
      {check.verdict === 'noAlignment' ? (
        <Notice tone="warn">{t('molbio.reads.noAlignment')}</Notice>
      ) : (
        <>
          <p className="num text-label text-fg-muted">
            {t('molbio.reads.trimmed', {
              from: check.trimmed.start + 1,
              to: check.trimmed.end,
              total: selected.bases.length,
            })}
          </p>
          <DataTable
            caption={t('molbio.reads.differencesCaption')}
            rows={check.differences}
            rowKey={(_, i) => String(i)}
            empty={t('molbio.reads.noDifferences')}
            columns={[
              {
                key: 'pos',
                head: t('molbio.reads.columns.position'),
                align: 'right',
                cell: (d) => (
                  <button
                    type="button"
                    className="text-fg hover:underline"
                    onClick={() => setFocus(d.readIndex)}
                  >
                    {d.position}
                  </button>
                ),
              },
              {
                key: 'kind',
                head: t('molbio.reads.columns.change'),
                cell: (d) => t(`molbio.reads.kind.${d.kind}`),
              },
              {
                key: 'exp',
                head: t('molbio.reads.columns.expected'),
                className: 'font-mono',
                cell: (d) => d.expected || '—',
              },
              {
                key: 'found',
                head: t('molbio.reads.columns.found'),
                className: 'font-mono',
                cell: (d) => d.found || '—',
              },
              {
                key: 'q',
                head: t('molbio.reads.columns.q'),
                align: 'right',
                cell: (d) => d.quality,
              },
              {
                key: 'conf',
                head: t('molbio.reads.columns.confidence'),
                cell: (d) =>
                  d.confirmed
                    ? t('molbio.reads.confirmed')
                    : t('molbio.reads.lowQuality'),
              },
              {
                key: 'feat',
                head: t('molbio.reads.columns.in'),
                cell: (d) => d.features.join(', ') || '—',
              },
            ]}
          />
        </>
      )}
      <Chromatogram
        read={selected}
        focus={focus}
        flipped={check.strand === -1}
      />
      {!selected.trace ? (
        <p className="text-label text-fg-muted">
          {t('molbio.reads.noTraceFile')}
        </p>
      ) : null}
    </Panel>
  )
}
