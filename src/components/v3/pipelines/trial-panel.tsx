import { t } from '#/copy'
import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Muted } from '#/components/v3/ui/layout'
import { PreviewTable } from '#/components/v3/pipelines/preview-table'
import { explainRunError } from '#/lib/pipelines/run-errors'
import type { PipelineTrialWire } from '#/lib/pipelines/types'

const OUTPUT_NOTE: Record<'create' | 'append' | 'none', string> = {
  create: t('data.trialPanel.realRunWouldAdd'),
  append: t('data.trialPanel.realRunWouldAppend'),
  none: t('data.trialPanel.pipelineHasOutputSo'),
}

/**
 * The answer to "Try draft": what the draft produced on the Dataset Versions
 * chosen, or why it could not. Always says that nothing was kept, and says so
 * plainly when the draft has been edited since, so an old answer is not read as
 * the current one.
 */
export function TrialPanel({
  result,
  stale,
  onTryAgain,
}: {
  result: PipelineTrialWire
  /** The draft was edited after this was produced. */
  stale: boolean
  onTryAgain: () => void
}) {
  return (
    <section
      aria-label={t('data.trialPanel.ariaTryDraftResult')}
      className="flex flex-col gap-3 rounded-md border border-border-subtle p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 font-sans text-label font-semibold">
          {t('data.trialPanel.ariaTryDraftResult')}
        </h2>
        {stale ? (
          <span className="text-label text-warn-text">
            {t('data.trialPanel.changedDraftAfterRan')}
          </span>
        ) : null}
        <span className="flex-1" />
        <Button size="sm" icon="play" onClick={onTryAgain}>
          {stale
            ? t('data.trialPanel.tryNewDraft')
            : t('common.actions.tryAgain')}
        </Button>
      </div>

      {result.ok ? (
        <>
          <Notice tone="info" icon="check">
            {result.stoppedAt
              ? t('data.trialPanel.stoppedWhichWaitsPerson', {
                  step: result.stoppedAt.step,
                })
              : t('data.trialPanel.ranS', {
                  toFixed: (result.durationMs / 1000).toFixed(1),
                })}{' '}
            {t('data.trialPanel.nothingSaved', {
              value: OUTPUT_NOTE[result.wouldWrite],
            })}
          </Notice>
          {result.preview.columns.length ? (
            <PreviewTable preview={result.preview} />
          ) : (
            <Muted>{t('data.trialPanel.draftReturnedRows')}</Muted>
          )}
        </>
      ) : (
        <FailedTrial code={result.errorCode} message={result.errorMessage} />
      )}
    </section>
  )
}

function FailedTrial({ code, message }: { code: string; message: string }) {
  const guidance = explainRunError(code)
  return (
    <Notice tone="bad" title={guidance.title}>
      <p className="m-0 whitespace-pre-wrap">{message}</p>
      <p className="m-0 mt-1">{guidance.hint}</p>
    </Notice>
  )
}
