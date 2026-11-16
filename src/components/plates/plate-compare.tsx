/**
 * Plates side by side: the plates analysed in one experiment in one table, so a
 * second plate of an assay reads against the first without copying a number. One
 * column per plate, newest first: quality, Z′, signal to background, hits, whether
 * it was read with the assay's remembered setup, and the potency of each sample.
 */
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

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
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  assayDesignKeys,
  fetchAssayDesigns,
  sameAssayConfig,
} from '#/lib/plate-assay-setup'
import type { AssayDesign } from '#/lib/plate-assay-setup'
import { plateRunReference } from '#/lib/plate-runs'
import type { PlateRunRow } from '#/lib/plate-runs'

import { fmt, qcTone, qualityLabel } from './plates-shared'

const client = notebookDataClient

/** A sample's potency on one plate, or why there is none. */
function potencyOf(run: PlateRunRow): Map<string, string> {
  const found = new Map<string, string>()

  for (const skipped of run.results?.unfitted ?? [])
    found.set(skipped.key, t('features.plateRuns.compare.notFitted'))

  for (const curve of run.results?.curves ?? [])
    found.set(
      curve.key,
      `${fmt(curve.ec50)} ${curve.concentrationUnit ?? ''}`.trim(),
    )

  return found
}

function setupCell(
  run: PlateRunRow,
  designs: ReadonlyMap<string, AssayDesign>,
): React.ReactNode {
  const design = run.design_id ? designs.get(run.design_id) : undefined

  if (!design?.setup)
    return (
      <span className="text-fg-muted">
        {design ? design.name : t('features.plateRuns.compare.noDesign')}
      </span>
    )

  return sameAssayConfig(run.config, design.setup.config) ? (
    <Status tone="ok">
      {t('features.plateRuns.compare.sameSetup', { design: design.name })}
    </Status>
  ) : (
    <Status tone="warn">
      {t('features.plateRuns.compare.differentSetup', { design: design.name })}
    </Status>
  )
}

export function PlateCompare({ runs }: { runs: PlateRunRow[] }) {
  const designs = useQuery({
    queryKey: assayDesignKeys.all,
    queryFn: () => fetchAssayDesigns(client),
    staleTime: 30_000,
  }).data

  const byId = useMemo(
    () => new Map((designs ?? []).map((design) => [design.id, design])),
    [designs],
  )

  // Samples that have a fitted curve or tried to, in the order the plates list them.
  const samples = useMemo(() => {
    const found = new Map<string, string>()

    for (const run of runs) {
      for (const curve of run.results?.curves ?? [])
        if (!found.has(curve.key)) found.set(curve.key, curve.label)

      for (const skipped of run.results?.unfitted ?? [])
        if (!found.has(skipped.key)) found.set(skipped.key, skipped.label)
    }

    return [...found.entries()]
  }, [runs])

  const potency = useMemo(
    () => new Map(runs.map((run) => [run.id, potencyOf(run)])),
    [runs],
  )

  return (
    <section
      aria-label={t('features.plateRuns.compare.title')}
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="m-0 font-heading text-doc font-semibold">
          {t('features.plateRuns.compare.title')}
        </h3>
        <p className="m-0 text-label text-fg-muted">
          {t('features.plateRuns.compare.hint')}
        </p>
      </div>
      <TableBox>
        <Table caption={t('features.plateRuns.compare.title')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('features.plateRuns.compare.metric')}</TableHead>
              {runs.map((run) => (
                <TableHead key={run.id}>
                  <Link
                    to="/plates"
                    search={{ run: run.id }}
                    className="mono text-link underline-offset-2 hover:underline"
                  >
                    {plateRunReference(run.number)}
                  </Link>
                  <span className="ml-2 font-normal">{run.name}</span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>{t('features.plateRuns.compare.quality')}</TableCell>
              {runs.map((run) => (
                <TableCell key={run.id}>
                  <Status tone={qcTone(run.qc_status)}>
                    {qualityLabel(run)}
                  </Status>
                </TableCell>
              ))}
            </TableRow>
            <TableRow>
              <TableCell>{t('features.plateRuns.compare.zPrime')}</TableCell>
              {runs.map((run) => (
                <TableCell key={run.id} className="num">
                  {fmt(run.results?.qc.zPrime, 2)}
                </TableCell>
              ))}
            </TableRow>
            <TableRow>
              <TableCell>
                {t('features.plateRuns.compare.signalToBackground')}
              </TableCell>
              {runs.map((run) => (
                <TableCell key={run.id} className="num">
                  {fmt(run.results?.qc.signalToBackground, 3)}
                </TableCell>
              ))}
            </TableRow>
            <TableRow>
              <TableCell>{t('features.plateRuns.compare.hits')}</TableCell>
              {runs.map((run) => (
                <TableCell key={run.id} className="num">
                  {run.results
                    ? t('features.plateRuns.summary.hitsOf', {
                        hits: run.results.summary.hitSamples,
                        tested: run.results.summary.testedSamples,
                      })
                    : ''}
                </TableCell>
              ))}
            </TableRow>
            <TableRow>
              <TableCell>{t('features.plateRuns.compare.setup')}</TableCell>
              {runs.map((run) => (
                <TableCell key={run.id}>{setupCell(run, byId)}</TableCell>
              ))}
            </TableRow>
            {samples.map(([key, label]) => (
              <TableRow key={key}>
                <TableCell>
                  <span className="font-medium">{label}</span>
                  <span className="ml-2 text-fg-muted">
                    {t('features.plateRuns.compare.potency')}
                  </span>
                </TableCell>
                {runs.map((run) => (
                  <TableCell key={run.id} className="num">
                    {potency.get(run.id)?.get(key) ?? ''}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableBox>
    </section>
  )
}
