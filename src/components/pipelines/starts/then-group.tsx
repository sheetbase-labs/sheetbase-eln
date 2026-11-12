import { t } from '#/copy'
import { BoardInput, BoardSelect } from '#/features/pipelines/board/board'
import type { StartRules } from '#/lib/pipelines/start-rules'

import type { RuleProblems } from './composer-model'
import { Group, OpTag, Row } from './composer-parts'

/** What a start does: how long it waits, overlap and missed runs. */
export function ThenGroup({
  draft,
  setDraft,
  problems,
  waitText,
  setWaitText,
}: {
  draft: StartRules
  setDraft: (next: StartRules) => void
  problems: RuleProblems
  waitText: string
  setWaitText: (text: string) => void
}) {
  return (
    <Group
      head={
        <>
          <OpTag>{t('features.pipelineStarts.composer.thenTag')}</OpTag>
          {t('features.pipelineStarts.composer.thenStart')}
        </>
      }
    >
      <Row icon="clock" type={t('features.pipelineStarts.composer.wait')}>
        <BoardInput
          style={{ width: 64 }}
          inputMode="numeric"
          aria-label={t('features.pipelineStarts.composer.wait')}
          aria-invalid={Boolean(problems.wait)}
          value={waitText}
          onChange={(event) => setWaitText(event.target.value)}
        />
        <span className="muted">
          {t('features.pipelineStarts.composer.waitUnit')}{' '}
          {t('features.pipelineStarts.composer.waitAfter')}
        </span>
      </Row>
      {problems.wait ? <div className="addl bad">{problems.wait}</div> : null}
      <Row icon="pause" type={t('features.pipelineStarts.composer.runGoing')}>
        <BoardSelect
          aria-label={t('features.pipelineStarts.composer.runGoing')}
          value="skip"
          disabled
        >
          <option value="skip">
            {t('features.pipelineStarts.composer.skip')}
          </option>
        </BoardSelect>
        <span className="muted">
          {t('features.pipelineStarts.composer.runGoingHint')}
        </span>
      </Row>
      <Row icon="info" type={t('features.pipelineStarts.composer.missed')}>
        <BoardSelect
          aria-label={t('features.pipelineStarts.composer.missed')}
          value={draft.missedRuns}
          onChange={(event) =>
            setDraft({
              ...draft,
              missedRuns: event.target.value === 'skip' ? 'skip' : 'run_once',
            })
          }
        >
          <option value="run_once">
            {t('features.pipelineStarts.composer.missedOnce')}
          </option>
          <option value="skip">
            {t('features.pipelineStarts.composer.missedSkip')}
          </option>
        </BoardSelect>
        <span className="muted">
          {t('features.pipelineStarts.composer.missedHint')}
        </span>
      </Row>
    </Group>
  )
}
