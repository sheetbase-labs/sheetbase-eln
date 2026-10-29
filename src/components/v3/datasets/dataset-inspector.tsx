import { Link } from '@tanstack/react-router'

import { t } from '#/copy'
import { Button } from '#/components/v3/ui/button'
import { DescriptionList, Inspector } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { datasetIssueSummary, datasetValidation } from './datasets-data'
import type { DatasetListRow } from './datasets-data'
import { formatDate } from '#/lib/format-date'

function dayLabel(value: string): string {
  return formatDate(value)
}

/**
 * The way out of each issue a dataset has: one button per problem, so a
 * sentence that says what is wrong is followed by the action that fixes it.
 */
export function DatasetIssueActions({ dataset }: { dataset: DatasetListRow }) {
  const missingUnit = dataset.missingUnitFields.length > 0
  const outOfRange = dataset.outOfRange > 0
  if (!missingUnit && !outOfRange) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {missingUnit ? (
        <>
          <Button
            size="sm"
            nativeButton={false}
            render={
              <Link
                to="/models"
                search={{ q: dataset.model, tab: undefined }}
              />
            }
          >
            {t('data.datasetInspector.setUnitModel')}
          </Button>
          <Button size="sm" nativeButton={false} render={<Link to="/import" />}>
            {t('data.datasetInspector.reImportUnitColumn')}
          </Button>
        </>
      ) : null}
      {outOfRange ? (
        <Button
          size="sm"
          nativeButton={false}
          render={
            <Link
              to="/datasets/$datasetId/rows"
              params={{ datasetId: dataset.uuid }}
            />
          }
        >
          {t('data.datasetInspector.showValues')}
        </Button>
      ) : null}
    </div>
  )
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
    <Inspector
      aria-label={t('data.datasetInspector.ariaDataset')}
      className="gap-0 p-0"
    >
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
            {hasIssues
              ? t('data.datasetInspector.openFix')
              : t('data.datasetInspector.openDataset')}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-4 px-4 py-3.5">
        {hasIssues ? (
          <section>
            <h2 className="mb-1.5 font-sans text-label font-semibold">
              {t('data.datasetInspector.issues')}
            </h2>
            <p className="text-label text-fg-muted">
              {datasetIssueSummary(dataset)}
            </p>
            <DatasetIssueActions dataset={dataset} />
          </section>
        ) : null}
        <section>
          <h2 className="mb-1.5 font-sans text-label font-semibold">
            {t('data.datasetInspector.details')}
          </h2>
          <DescriptionList
            labelWidth={88}
            items={[
              [
                t('data.datasetInspector.rows'),
                dataset.rows.toLocaleString('en-GB'),
              ],
              [t('data.datasetInspector.model'), dataset.model],
              [
                t('data.datasetInspector.experiment'),
                dataset.experimentId ?? '—',
              ],
              [t('data.datasetInspector.updated'), dayLabel(dataset.updatedAt)],
            ]}
          />
        </section>
      </div>
    </Inspector>
  )
}
