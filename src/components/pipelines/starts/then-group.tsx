import { t } from '#/copy'
import { Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
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
          <span>{t('features.pipelineStarts.composer.thenStart')}</span>
        </>
      }
    >
      <Row icon="clock" type={t('features.pipelineStarts.composer.wait')}>
        <Input
          inputMode="numeric"
          className="h-[26px] w-[72px] text-caption"
          aria-label={t('features.pipelineStarts.composer.wait')}
          aria-invalid={Boolean(problems.wait)}
          value={waitText}
          onChange={(event) => setWaitText(event.target.value)}
        />
        <span>{t('features.pipelineStarts.composer.waitUnit')}</span>
        <span className="text-fg-muted">
          {problems.wait ? (
            <span className="text-danger-text">{problems.wait}</span>
          ) : (
            t('features.pipelineStarts.composer.waitAfter')
          )}
        </span>
      </Row>
      <Row icon="pause" type={t('features.pipelineStarts.composer.runGoing')}>
        <Select
          size="sm"
          className="w-auto"
          aria-label={t('features.pipelineStarts.composer.runGoing')}
          value="skip"
          disabled
        >
          <option value="skip">
            {t('features.pipelineStarts.composer.skip')}
          </option>
        </Select>
        <span className="text-fg-muted">
          {t('features.pipelineStarts.composer.runGoingHint')}
        </span>
      </Row>
      <Row icon="repeat" type={t('features.pipelineStarts.composer.missed')}>
        <Select
          size="sm"
          className="w-auto"
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
        </Select>
        <span className="text-fg-muted">
          {t('features.pipelineStarts.composer.missedHint')}
        </span>
      </Row>
    </Group>
  )
}
