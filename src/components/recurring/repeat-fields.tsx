import { Chip } from '#/components/ui/chip'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { isoWeekday } from '#/lib/recurring'
import type { RepeatForm } from '#/lib/recurring'
import { t } from '#/copy'

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
const FREQUENCIES = ['none', 'daily', 'weekly', 'monthly'] as const
const END_MODES = ['count', 'date'] as const

/** The frequency a selected option names; anything else does not repeat. */
function frequencyOf(optionValue: string): RepeatForm['frequency'] {
  return FREQUENCIES.find((frequency) => frequency === optionValue) ?? 'none'
}

/** The end mode a selected option names; anything else ends after a count. */
function endModeOf(optionValue: string): RepeatForm['endMode'] {
  return END_MODES.find((mode) => mode === optionValue) ?? 'count'
}

/** The copy key for a repeat's unit; the fields render it only while repeating. */
function repeatUnitOf(
  frequency: RepeatForm['frequency'],
): 'daily' | 'weekly' | 'monthly' {
  return frequency === 'none' ? 'daily' : frequency
}

/**
 * How often something repeats and when it stops: the fields a booking and an
 * experiment schedule share. Controlled; the owner keeps the `RepeatForm` and
 * checks it with `repeatFormError` before it asks the database.
 */
export function RepeatFields({
  value,
  onChange,
  firstDay,
  allowNone = true,
}: {
  value: RepeatForm
  onChange: (next: RepeatForm) => void
  /** The day the first one falls on; weekly repeats start from its weekday. */
  firstDay: string
  /** A booking can also not repeat; an experiment schedule always does. */
  allowNone?: boolean
}) {
  const set = (patch: Partial<RepeatForm>) => onChange({ ...value, ...patch })
  const repeating = value.frequency !== 'none'

  return (
    <div className="flex flex-col gap-3.5">
      <Field label={t('projects.recurring.repeat')}>
        <Select
          value={value.frequency}
          onChange={(e) => {
            const frequency = frequencyOf(e.target.value)
            set({
              frequency,
              // A weekly repeat starts on the day it was first set for.
              weekdays:
                frequency === 'weekly' && value.weekdays.length === 0
                  ? [isoWeekday(firstDay)]
                  : value.weekdays,
            })
          }}
        >
          {allowNone ? (
            <option value="none">
              {t('projects.recurring.doesNotRepeat')}
            </option>
          ) : null}
          <option value="daily">
            {t('projects.recurring.frequency.daily')}
          </option>
          <option value="weekly">
            {t('projects.recurring.frequency.weekly')}
          </option>
          <option value="monthly">
            {t('projects.recurring.frequency.monthly')}
          </option>
        </Select>
      </Field>
      {repeating ? (
        <>
          <div className="grid grid-cols-[auto_1fr] items-end gap-3">
            <Field label={t('projects.recurring.every')}>
              <Input
                type="number"
                min={1}
                max={52}
                className="w-20"
                value={value.interval}
                onChange={(e) => set({ interval: Number(e.target.value) })}
              />
            </Field>
            <span className="pb-1.5 text-body text-fg-muted">
              {t(`projects.recurring.unit.${repeatUnitOf(value.frequency)}`)}
            </span>
          </div>
          {value.frequency === 'weekly' ? (
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="mb-1 p-0 text-label font-medium text-fg">
                {t('projects.recurring.on')}
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((day) => (
                  <Chip
                    key={day}
                    pressed={value.weekdays.includes(day)}
                    onClick={() =>
                      set({
                        weekdays: value.weekdays.includes(day)
                          ? value.weekdays.filter((d) => d !== day)
                          : [...value.weekdays, day].sort((a, b) => a - b),
                      })
                    }
                  >
                    {t(`projects.recurring.weekdaysShort.${day}`)}
                  </Chip>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('projects.recurring.ends')}>
              <Select
                value={value.endMode}
                onChange={(e) => set({ endMode: endModeOf(e.target.value) })}
              >
                <option value="count">
                  {t('projects.recurring.endsAfter')}
                </option>
                <option value="date">{t('projects.recurring.endsOn')}</option>
              </Select>
            </Field>
            {value.endMode === 'count' ? (
              <Field label={t('projects.recurring.times')}>
                <Input
                  type="number"
                  min={1}
                  max={400}
                  value={value.count}
                  onChange={(e) => set({ count: Number(e.target.value) })}
                />
              </Field>
            ) : (
              <Field label={t('projects.recurring.lastDay')}>
                <Input
                  type="date"
                  min={firstDay}
                  value={value.until}
                  onChange={(e) => set({ until: e.target.value })}
                />
              </Field>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
