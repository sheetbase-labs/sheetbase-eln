import { Link } from '@tanstack/react-router'

import { DescriptionList, Muted, Section } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import { Tooltip } from '#/components/ui/tooltip'
import { AddedFields } from '#/components/models/added-fields'
import {
  calibrationStatus,
  formatInstrumentDay,
} from '#/components/instruments/instruments-data'
import type {
  InstrumentCalibrationRow,
  InstrumentChange,
  InstrumentRow,
  InstrumentUsedBy,
} from '#/components/instruments/instruments-data'
import { t } from '#/copy'

/** The instrument's stored fields, with the calibration countdown. */
export function FieldsSection({
  instrument,
  userLabel,
  latest,
}: {
  instrument: InstrumentRow
  userLabel: (userId: string) => string
  latest: InstrumentCalibrationRow | null
}) {
  const i = instrument
  const status = calibrationStatus(latest?.dueAt ?? null)

  return (
    <Section
      className="border-t border-border pt-4"
      title={t('library.instruments.record.fields')}
    >
      <DescriptionList
        labelWidth={130}
        items={[
          ['Manufacturer', i.vendor ?? '—'],
          ['Model', i.model ?? '—'],
          ['Serial', <span className="mono">{i.serialNumber ?? '—'}</span>],
          ['Location', i.location ?? '—'],
          ['Owner', i.ownerId ? userLabel(i.ownerId) : '—'],
          [
            t('library.instruments.record.qualifiedFor'),
            i.qualifiedFor ?? t('library.instruments.record.notSet'),
          ],
          [
            t('library.instruments.record.calibrationDue'),
            latest ? (
              <Status tone={status.tone}>
                {formatInstrumentDay(latest.dueAt)}
              </Status>
            ) : (
              t('library.instruments.record.notRecorded')
            ),
          ],
        ]}
      />
    </Section>
  )
}

/** The datasets imported from this instrument. */
export function UsedBySection({ rows }: { rows: InstrumentUsedBy[] }) {
  return (
    <Section
      className="border-t border-border pt-4"
      title={t('library.instruments.record.usedBy')}
      count={rows.length}
    >
      {rows.length ? (
        <TableBox>
          <table className="w-full text-label">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="px-2 py-1 font-medium">
                  {t('library.instruments.record.usedByName')}
                </th>
                <th className="px-2 py-1 font-medium">
                  {t('library.instruments.record.usedByHow')}
                </th>
                <th className="px-2 py-1 text-right font-medium">
                  {t('library.instruments.record.usedBySince')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-border">
                  <td className="px-2 py-1">
                    {row.link ? (
                      <Link
                        to={row.link.to}
                        params={{ datasetId: row.link.id }}
                      >
                        {row.label}
                      </Link>
                    ) : (
                      row.label
                    )}
                  </td>
                  <td className="px-2 py-1 text-fg-muted">{row.how}</td>
                  <td className="px-2 py-1 text-right whitespace-nowrap text-fg-muted">
                    {formatInstrumentDay(row.since)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableBox>
      ) : (
        <Muted>
          {t('library.instruments.record.nothingHasBeenImportedFrom')}
        </Muted>
      )}
    </Section>
  )
}

/** Every change to the instrument's name, location and fields. */
export function HistorySection({
  entries,
  userLabel,
}: {
  entries: InstrumentChange[]
  userLabel: (userId: string) => string
}) {
  if (!entries.length) return null

  return (
    <Section
      className="border-t border-border pt-4"
      title={
        <Tooltip content="Renaming this instrument or moving it to another room updates every record that mentions it. Anything already signed keeps what it showed at the time.">
          <span tabIndex={0}>
            {t('library.instruments.record.changeHistory')}
          </span>
        </Tooltip>
      }
    >
      <TableBox>
        <table className="w-full text-label">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="px-2 py-1 font-medium">
                {t('library.instruments.record.when')}
              </th>
              <th className="px-2 py-1 font-medium">
                {t('library.instruments.record.change')}
              </th>
              <th className="px-2 py-1 font-medium">
                {t('library.instruments.record.by')}
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-border">
                <td className="px-2 py-1 whitespace-nowrap">
                  {formatInstrumentDay(entry.at)}
                </td>
                <td className="px-2 py-1">
                  {entry.changes.length
                    ? entry.changes.map((c) => (
                        <div key={c.label}>
                          {c.label}{' '}
                          <del className="text-fg-muted">{c.from ?? '—'}</del> →{' '}
                          <ins className="no-underline">{c.to ?? '—'}</ins>
                        </div>
                      ))
                    : t('library.instruments.record.registered')}
                </td>
                <td className="px-2 py-1">
                  {entry.actorUserId ? userLabel(entry.actorUserId) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableBox>
    </Section>
  )
}

/** The model's added fields, rendered as their own section. */
export function InstrumentAddedFields({
  instrumentId,
}: {
  instrumentId: string
}) {
  return (
    <AddedFields
      modelKey="instrument"
      objectId={instrumentId}
      variant="section"
      labelWidth={130}
    />
  )
}
