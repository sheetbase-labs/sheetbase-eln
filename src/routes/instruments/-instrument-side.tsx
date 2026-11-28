/**
 * The instrument page's side panel: the fields the header does not say, the
 * model's added fields, and who has it booked this week.
 */
import { AddedFields } from '#/components/models/added-fields'
import { formatInstrumentDay } from '#/components/instruments/instruments-data'
import type { InstrumentRow } from '#/components/instruments/instruments-data'
import { RecordProperties } from '#/components/record-page/record-side-panel'
import { InspectorSection, Muted } from '#/components/ui/layout'
import { instrumentTypeLabel } from '#/lib/instrument-type-label'
import { t } from '#/copy'

/** One booking in the week the side panel lists. */
export interface InstrumentWeekBooking {
  id: string
  title: string
  starts_at: string
  created_by_user_id: string | null
}

export function InstrumentSidePanel({
  instrument,
  userLabel,
  week,
}: {
  instrument: InstrumentRow
  userLabel: (userId: string) => string
  week: readonly InstrumentWeekBooking[]
}) {
  const i = instrument

  return (
    <>
      <RecordProperties
        items={[
          {
            label: t('library.instruments.record.typeField'),
            value: instrumentTypeLabel(i.instrumentType),
          },
          {
            label: t('library.instruments.record.manufacturerField'),
            value: i.vendor,
          },
          { label: t('library.instruments.record.modelField'), value: i.model },
          {
            label: t('library.instruments.record.serialField'),
            value: i.serialNumber,
            mono: true,
          },
          {
            label: t('library.instruments.record.qualifiedFor'),
            value: i.qualifiedFor,
          },
          {
            label: t('library.instruments.record.createdField'),
            value: i.createdAt
              ? i.createdByUserId
                ? t('library.instruments.record.createdOnBy', {
                    date: formatInstrumentDay(i.createdAt),
                    name: userLabel(i.createdByUserId),
                  })
                : formatInstrumentDay(i.createdAt)
              : null,
          },
        ]}
      />
      <AddedFields modelKey="instrument" objectId={i.id} labelWidth={104} />
      <InspectorSection
        title={t('library.instruments.record.bookingsThisWeek')}
      >
        {week.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label">
            {week.map((b) => (
              <li key={b.id}>
                {b.starts_at.slice(5, 10)} {b.starts_at.slice(11, 16)} ·{' '}
                {b.created_by_user_id
                  ? userLabel(b.created_by_user_id)
                  : b.title}
              </li>
            ))}
          </ul>
        ) : (
          <Muted>{t('library.instruments.record.noneInTheNextSeven')}</Muted>
        )}
      </InspectorSection>
    </>
  )
}
