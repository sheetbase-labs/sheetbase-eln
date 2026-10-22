import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Muted } from '#/components/v3/ui/layout'
import { PreviewTable } from '#/components/v3/pipelines/preview-table'
import { explainRunError } from '#/lib/pipelines/run-errors'
import type { PipelineTrialWire } from '#/lib/pipelines/types'

const OUTPUT_NOTE: Record<'create' | 'append' | 'none', string> = {
  create: 'A real run would add these rows to the pipeline’s dataset.',
  append: 'A real run would append these rows to the chosen dataset.',
  none: 'This pipeline has no output, so a real run would only show this result.',
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
      aria-label="Try draft result"
      className="flex flex-col gap-3 rounded-md border border-border-subtle p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 font-sans text-label font-semibold">
          Try draft result
        </h2>
        {stale ? (
          <span className="text-label text-warn-text">
            You changed the draft after this ran.
          </span>
        ) : null}
        <span className="flex-1" />
        <Button size="sm" icon="play" onClick={onTryAgain}>
          {stale ? 'Try the new draft' : 'Try again'}
        </Button>
      </div>

      {result.ok ? (
        <>
          <Notice tone="info" icon="check">
            {result.stoppedAt
              ? `Stopped at “${result.stoppedAt.step}”, which waits for a person. Showing what it proposes.`
              : `Ran in ${(result.durationMs / 1000).toFixed(1)}s.`}{' '}
            Nothing was saved. {OUTPUT_NOTE[result.wouldWrite]}
          </Notice>
          {result.preview.columns.length ? (
            <PreviewTable preview={result.preview} />
          ) : (
            <Muted>The draft returned no rows.</Muted>
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
