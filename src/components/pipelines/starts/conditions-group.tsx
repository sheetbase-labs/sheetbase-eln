import { t } from '#/copy'
import { BoardInput, BoardSelect } from '#/features/pipelines/board/board'
import { WINDOW_DAYS } from '#/lib/pipelines/start-rules'
import type { StartRules } from '#/lib/pipelines/start-rules'

import { DEFAULT_WINDOW } from './composer-model'
import type { RuleProblems } from './composer-model'
import { Group, LinkButton, OpTag, Row, RowButton } from './composer-parts'

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
  const window = draft.window

  const setWindow = (patch: Partial<NonNullable<StartRules['window']>>) => {
    if (window) setDraft({ ...draft, window: { ...window, ...patch } })
  }

  return (
    <Group
      head={
        <>
          <OpTag>{t('features.pipelineStarts.composer.andTag')}</OpTag>
          <span>{t('features.pipelineStarts.composer.onlyIf')}</span>
          {bothConditions ? (
            <BoardSelect
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
            </BoardSelect>
          ) : (
            <span>{t('features.pipelineStarts.composer.all')}</span>
          )}
          <span>{t('features.pipelineStarts.composer.ofTheseTrue')}</span>
        </>
      }
    >
      {window ? (
        <Row
          icon="calendar"
          type={t('features.pipelineStarts.composer.hours')}
          action={
            <RowButton
              label={t('features.pipelineStarts.composer.remove')}
              icon="x"
              onClick={() => setDraft({ ...draft, window: null })}
            />
          }
        >
          <BoardSelect
            aria-label={t('features.pipelineStarts.composer.windowDaysLabel')}
            value={window.days}
            onChange={(event) => {
              const days = WINDOW_DAYS.find((d) => d === event.target.value)

              if (days) setWindow({ days })
            }}
          >
            {WINDOW_DAYS.map((days) => (
              <option key={days} value={days}>
                {t(`features.pipelineStarts.composer.windowDays.${days}`)}
              </option>
            ))}
          </BoardSelect>
          <BoardInput
            style={{ width: 58 }}
            inputMode="numeric"
            aria-label={t('features.pipelineStarts.composer.windowFrom')}
            aria-invalid={Boolean(problems.window)}
            value={window.from}
            onChange={(event) => setWindow({ from: event.target.value })}
          />
          <span className="muted">
            {t('features.pipelineStarts.composer.to')}
          </span>
          <BoardInput
            style={{ width: 58 }}
            inputMode="numeric"
            aria-label={t('features.pipelineStarts.composer.windowTo')}
            aria-invalid={Boolean(problems.window)}
            value={window.to}
            onChange={(event) => setWindow({ to: event.target.value })}
          />
          <BoardInput
            style={{ width: 132 }}
            aria-label={t('features.pipelineStarts.composer.windowZone')}
            value={window.timeZone}
            onChange={(event) => setWindow({ timeZone: event.target.value })}
          />
        </Row>
      ) : null}
      {problems.window ? (
        <div className="addl bad">{problems.window}</div>
      ) : null}
      {draft.minNewRows !== null ? (
        <>
          <Row
            icon="filter"
            type={t('features.pipelineStarts.composer.condition')}
            action={
              <RowButton
                label={t('features.pipelineStarts.composer.remove')}
                icon="x"
                onClick={() => setDraft({ ...draft, minNewRows: null })}
              />
            }
          >
            <span>{t('features.pipelineStarts.composer.rowsIn')}</span>
            <span className="muted">
              {t('features.pipelineStarts.composer.atLeast')}
            </span>
            <BoardInput
              style={{ width: 44 }}
              inputMode="numeric"
              aria-label={t('features.pipelineStarts.composer.rowsLabel')}
              aria-invalid={Boolean(problems.rows)}
              value={rowsText}
              onChange={(event) => setRowsText(event.target.value)}
            />
          </Row>
          {problems.rows ? (
            <div className="addl bad">{problems.rows}</div>
          ) : null}
          <div className="addl muted" style={{ fontSize: 11 }}>
            {t('features.pipelineStarts.composer.rowsHint')}
          </div>
        </>
      ) : null}
      <div className="addl">
        {window === null ? (
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
