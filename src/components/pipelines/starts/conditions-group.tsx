import { t } from '#/copy'
import { IconButton } from '#/components/ui/icon-button'
import { Input } from '#/components/ui/input'
import { Muted } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { WINDOW_DAYS } from '#/lib/pipelines/start-rules'
import type { StartRules } from '#/lib/pipelines/start-rules'

import { DEFAULT_WINDOW } from './composer-model'
import type { RuleProblems } from './composer-model'
import { Group, LinkButton, OpTag, Row } from './composer-parts'

/** The hours and new-row conditions that gate a start. */
export function ConditionsGroup({
  draft,
  setDraft,
  problems,
  rowsText,
  setRowsText,
  rowsValue,
}: {
  draft: StartRules
  setDraft: (next: StartRules) => void
  problems: RuleProblems
  rowsText: string
  setRowsText: (text: string) => void
  rowsValue: number | null
}) {
  const bothConditions = draft.window !== null && draft.minNewRows !== null
  const noCondition = draft.window === null && draft.minNewRows === null

  return (
    <Group
      head={
        <>
          <OpTag>{t('features.pipelineStarts.composer.andTag')}</OpTag>
          <span>{t('features.pipelineStarts.composer.onlyIf')}</span>
          {bothConditions ? (
            <Select
              size="sm"
              className="h-6 w-auto text-caption"
              aria-label={t('features.pipelineStarts.composer.onlyIf')}
              value={draft.conditionsMatch}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  conditionsMatch: event.target.value === 'any' ? 'any' : 'all',
                })
              }
            >
              <option value="all">
                {t('features.pipelineStarts.composer.allWord')}
              </option>
              <option value="any">
                {t('features.pipelineStarts.composer.anyWord')}
              </option>
            </Select>
          ) : (
            <span>{t('features.pipelineStarts.composer.all')}</span>
          )}
          <span>{t('features.pipelineStarts.composer.ofTheseTrue')}</span>
        </>
      }
    >
      {draft.window ? (
        <Row
          icon="calendar"
          type={t('features.pipelineStarts.composer.hours')}
          action={
            <IconButton
              label={t('features.pipelineStarts.composer.remove')}
              icon="x"
              onClick={() => setDraft({ ...draft, window: null })}
            />
          }
        >
          <Select
            size="sm"
            className="w-auto"
            aria-label={t('features.pipelineStarts.composer.windowDaysLabel')}
            value={draft.window.days}
            onChange={(event) => {
              const days = WINDOW_DAYS.find((d) => d === event.target.value)

              if (days && draft.window)
                setDraft({ ...draft, window: { ...draft.window, days } })
            }}
          >
            {WINDOW_DAYS.map((days) => (
              <option key={days} value={days}>
                {t(`features.pipelineStarts.composer.windowDays.${days}`)}
              </option>
            ))}
          </Select>
          <Input
            type="time"
            className="h-[26px] w-[104px] text-caption"
            aria-label={t('features.pipelineStarts.composer.windowFrom')}
            aria-invalid={Boolean(problems.window)}
            value={draft.window.from}
            onChange={(event) =>
              draft.window &&
              setDraft({
                ...draft,
                window: { ...draft.window, from: event.target.value },
              })
            }
          />
          <span className="text-fg-muted">
            {t('features.pipelineStarts.composer.to')}
          </span>
          <Input
            type="time"
            className="h-[26px] w-[104px] text-caption"
            aria-label={t('features.pipelineStarts.composer.windowTo')}
            aria-invalid={Boolean(problems.window)}
            value={draft.window.to}
            onChange={(event) =>
              draft.window &&
              setDraft({
                ...draft,
                window: { ...draft.window, to: event.target.value },
              })
            }
          />
          <Input
            className="h-[26px] w-[132px] text-caption"
            aria-label={t('features.pipelineStarts.composer.windowZone')}
            value={draft.window.timeZone}
            onChange={(event) =>
              draft.window &&
              setDraft({
                ...draft,
                window: { ...draft.window, timeZone: event.target.value },
              })
            }
          />
          {problems.window ? (
            <span className="basis-full text-danger-text">
              {problems.window}
            </span>
          ) : null}
        </Row>
      ) : null}
      {draft.minNewRows !== null ? (
        <>
          <Row
            icon="filter"
            type={t('features.pipelineStarts.composer.condition')}
            action={
              <IconButton
                label={t('features.pipelineStarts.composer.remove')}
                icon="x"
                onClick={() => setDraft({ ...draft, minNewRows: null })}
              />
            }
          >
            <span>{t('features.pipelineStarts.composer.rowsIn')}</span>
            <span className="text-fg-muted">
              {t('features.pipelineStarts.composer.atLeast')}
            </span>
            <Input
              inputMode="numeric"
              className="h-[26px] w-16 text-caption"
              aria-label={t('features.pipelineStarts.composer.rowsLabel')}
              aria-invalid={Boolean(problems.rows)}
              value={rowsText}
              onChange={(event) => setRowsText(event.target.value)}
            />
            {problems.rows ? (
              <span className="basis-full text-danger-text">
                {problems.rows}
              </span>
            ) : null}
          </Row>
          <Muted className="pl-6">
            {t('features.pipelineStarts.composer.rowsHint')}
          </Muted>
        </>
      ) : null}
      <div className="flex flex-wrap gap-x-4 py-0.5 pl-6">
        {draft.window === null ? (
          <LinkButton
            onClick={() =>
              setDraft({ ...draft, window: { ...DEFAULT_WINDOW } })
            }
          >
            {noCondition
              ? t('features.pipelineStarts.composer.addCondition')
              : t('features.pipelineStarts.composer.addHours')}
          </LinkButton>
        ) : null}
        {draft.minNewRows === null ? (
          <LinkButton
            onClick={() => setDraft({ ...draft, minNewRows: rowsValue ?? 1 })}
          >
            {t('features.pipelineStarts.composer.addRows')}
          </LinkButton>
        ) : null}
      </div>
    </Group>
  )
}
