import { Link } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { DescriptionList, Inspector } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { datasetIssueSummary, datasetValidation } from './datasets-data'
import type { DatasetListRow } from './datasets-data'

function dayLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * The right-hand panel of the dataset list: what is wrong with the selected
 * dataset, if anything, and the facts that identify it. Fixing it happens on
 * the dataset's own page.
 */
export function DatasetInspector({ dataset }: { dataset: DatasetListRow }) {
  const validation = datasetValidation(dataset)
  const hasIssues = dataset.issues > 0
  return (
    <Inspector aria-label="Dataset" className="gap-0 p-0">
      <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
        <span className="mono text-fg-muted">{dataset.id}</span>
        <div className="font-heading text-doc font-semibold">
          {dataset.name}
        </div>
        <div className="text-label">
          <Status tone={validation.tone}>{validation.label}</Status>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            nativeButton={false}
            render={
              <Link
                to="/datasets/$datasetId"
                params={{ datasetId: dataset.uuid }}
              />
            }
          >
            {hasIssues ? 'Open and fix' : 'Open dataset'}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-4 px-4 py-3.5">
        {hasIssues ? (
          <section>
            <h2 className="mb-1.5 font-sans text-label font-semibold">
              Issues
            </h2>
            <p className="text-label text-fg-muted">
              {datasetIssueSummary(dataset)}
            </p>
          </section>
        ) : null}
        <section>
          <h2 className="mb-1.5 font-sans text-label font-semibold">Details</h2>
          <DescriptionList
            labelWidth={88}
            items={[
              ['Rows', dataset.rows.toLocaleString('en-GB')],
              ['Model', dataset.model],
              ['Experiment', dataset.experimentId ?? '—'],
              ['Updated', dayLabel(dataset.updatedAt)],
            ]}
          />
        </section>
      </div>
    </Inspector>
  )
}
