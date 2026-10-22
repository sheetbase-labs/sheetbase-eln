import { Link } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Muted } from '#/components/v3/ui/layout'
import { PreviewTable } from '#/components/v3/pipelines/preview-table'
import { readResultPreview } from '#/lib/pipelines/result-preview'
import type {
  PipelineRunOutputWire,
  PipelineRunWire,
} from '#/lib/pipelines/types'

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`

/**
 * What a succeeded run produced: the answer first (a preview of the result
 * rows), then where it was kept, with links to the Dataset and the Dataset
 * Version this run wrote. A run that keeps nothing says so, and where to
 * change that, instead of leaving the reader to work out where the answer went.
 */
export function RunResult({
  run,
  pipelineId,
  outputs,
  datasetNames,
}: {
  run: Pick<PipelineRunWire, 'result'>
  pipelineId: string
  outputs: PipelineRunOutputWire[]
  /** Dataset id → readable name. */
  datasetNames: Record<string, string>
}) {
  const preview = readResultPreview(run.result)
  const rowCount =
    preview?.rowCount ??
    (typeof run.result.rowCount === 'number' ? run.result.rowCount : null)

  return (
    <section aria-label="Result" className="flex flex-col gap-3">
      <h2 className="m-0 font-sans text-label font-semibold">Result</h2>

      {outputs.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {outputs.map((output) => (
            <li key={output.id}>
              <Notice
                tone="info"
                icon="check"
                action={
                  <Button
                    size="sm"
                    nativeButton={false}
                    render={
                      <Link
                        to="/datasets/$datasetId/snapshots"
                        params={{ datasetId: output.dataset_id }}
                      />
                    }
                  >
                    Open dataset
                  </Button>
                }
              >
                {rowCount === null
                  ? 'Saved'
                  : `${plural(rowCount, 'row', 'rows')} saved`}{' '}
                to{' '}
                <Link
                  to="/datasets/$datasetId"
                  params={{ datasetId: output.dataset_id }}
                  className="font-semibold underline"
                >
                  {datasetNames[output.dataset_id] ?? 'the dataset'}
                </Link>{' '}
                as the Dataset Version “{output.label}”.
              </Notice>
            </li>
          ))}
        </ul>
      ) : (
        <Notice
          tone="warn"
          title="Nothing was saved."
          action={
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link
                  to="/pipelines/$pipelineId/steps"
                  params={{ pipelineId }}
                />
              }
            >
              Set an output
            </Button>
          }
        >
          This pipeline has no output, so the result below is only a preview of
          this run. Create or append to a dataset to keep it.
        </Notice>
      )}

      {preview && preview.columns.length ? (
        <PreviewTable preview={preview} keptAll={outputs.length > 0} />
      ) : rowCount !== null ? (
        <Muted>
          {rowCount === 0
            ? 'The transform returned no rows.'
            : `${plural(rowCount, 'row', 'rows')} computed. This run is older than result previews, so the rows are not shown.`}
        </Muted>
      ) : null}
    </section>
  )
}
