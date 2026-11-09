import { useState } from 'react'

import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { t } from '#/copy'
import { usePageAi } from '#/lib/use-page-ai'
import { preSignFacts } from '#/lib/pre-sign-review'
import type { PreSignReview, PreSignWarning } from '#/lib/pre-sign-review'
import type { RevisionDiffResult } from '#/lib/revision-diff'

/** What goes to the signing dialog: the review and the diff it came from. */
export interface PreSignInput {
  review: PreSignReview
  diff: RevisionDiffResult | null
}

function warningText(warning: PreSignWarning): string {
  const values = {
    count: warning.count,
    field: warning.field,
    where: warning.where,
    limit: warning.limit ?? '',
  }

  return warning.kind === 'missing-unit'
    ? t('projects.preSign.warning.missingUnit', values)
    : warning.kind === 'out-of-spec'
      ? t('projects.preSign.warning.outOfSpec', values)
      : t('projects.preSign.warning.emptyRequired', values)
}

/**
 * Shown above the signing form: what changed and anything worth a second
 * look. Advisory only; the signature button never depends on it.
 */
export function PreSignSummary({ input }: { input: PreSignInput }) {
  const { review, diff } = input
  const ai = usePageAi()
  const [text, setText] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle')

  async function summarise() {
    setState('working')

    const result = await ai
      .run({ task: 'summarise', text: preSignFacts(review, diff) })
      .catch(() => null)

    if (result?.status === 'ok') {
      setText(result.text)
      setState('idle')
    } else {
      setState('failed')
    }
  }

  return (
    <section
      aria-label={t('projects.preSign.title')}
      data-testid="pre-sign-summary"
      className="flex flex-col gap-3 rounded-md border border-border p-3 text-label"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-label font-semibold">
          {t('projects.preSign.changesHeading')}
        </h3>
        {ai.live && text === null ? (
          <Button
            type="button"
            variant="quiet"
            size="sm"
            icon="spark"
            disabled={state === 'working'}
            onClick={() => void summarise()}
          >
            {state === 'working'
              ? t('projects.preSign.ai.working')
              : t('projects.preSign.ai.summarise')}
          </Button>
        ) : null}
      </div>
      {text !== null ? (
        <div className="flex flex-col gap-1">
          <p className="m-0">{text}</p>
          <p className="m-0 flex items-center gap-1 text-fg-muted">
            <Icon name="spark" size={12} aria-hidden />
            {t('projects.preSign.ai.label')}
          </p>
        </div>
      ) : null}
      {state === 'failed' ? (
        <p className="m-0 text-fg-muted">{t('projects.preSign.ai.failed')}</p>
      ) : null}
      {review.compared && review.changes.length === 0 ? (
        <p className="m-0 text-fg-muted">{t('projects.preSign.unchanged')}</p>
      ) : (
        <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4">
          {!review.compared ? (
            <li className="list-none -ml-4 text-fg-muted">
              {t('projects.preSign.firstVersion')}
            </li>
          ) : null}
          {review.changes.map((line) => (
            <li key={line.area}>
              {line.area === 'first'
                ? null
                : review.compared
                  ? t(`projects.preSign.changed.${line.area}`, {
                      count: line.count,
                    })
                  : t(
                      `projects.preSign.contents.${line.area as 'blocks' | 'tables' | 'files' | 'links'}`,
                      { count: line.count },
                    )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-1 border-t border-border pt-2">
        <h3 className="m-0 text-label font-semibold">
          {t('projects.preSign.warningsHeading')}
        </h3>
        {review.warnings.length === 0 ? (
          <p className="m-0 text-fg-muted">
            {t('projects.preSign.noWarnings')}
          </p>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {review.warnings.map((warning) => (
                <li key={warning.id} className="flex items-start gap-2">
                  <Icon
                    name="warn"
                    size={14}
                    className="mt-0.5 shrink-0 text-warning-text"
                    aria-hidden
                  />
                  <span>{warningText(warning)}</span>
                </li>
              ))}
            </ul>
            <p className="m-0 text-fg-muted">
              {t('projects.preSign.warningsNote')}
            </p>
          </>
        )}
      </div>
    </section>
  )
}
