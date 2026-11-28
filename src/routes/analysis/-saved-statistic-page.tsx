import { useMemo, useState } from 'react'

import { t } from '#/copy'
import { AskAiButton } from '#/components/assist/ask-ai-button'
import { Button } from '#/components/ui/button'
import { PageHeader } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { Status } from '#/components/ui/status'
import { AnalysisPanel } from '#/components/viz/analysis-panel'
import type { AnalysisDefinitionWire } from '#/lib/analysis-definitions-data'
import { toCanonicalDatasetSource } from '#/lib/chart-data'
import { formatDate } from '#/lib/format-date'
import { statisticSummary } from '../-analysis-list-model'
import { analysisTrail, useAnalysisPlace } from './-analysis-trail'
import { useAnalysisStudioReads } from './-analysis-studio-hooks'

/**
 * A saved statistic at its own address: its name in the header, and the
 * statistic already loaded and run on the rows it reads. Changing it here and
 * saving writes a new version of the same statistic.
 */
export function SavedStatisticPage({
  statistic,
  workspaceId,
  userId,
}: {
  statistic: AnalysisDefinitionWire
  workspaceId: string
  userId: string
}) {
  const summary = statisticSummary(statistic)
  const [datasetId, setDatasetId] = useState(summary.datasetId ?? null)
  const place = useAnalysisPlace(summary.datasetId ?? null)
  const { datasets } = useAnalysisStudioReads()

  const sources = useMemo(
    () => datasets.map(toCanonicalDatasetSource),
    [datasets],
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader
        trail={analysisTrail({
          place,
          label: statistic.display_id ?? `v${statistic.version}`,
        })}
        title={statistic.name}
        meta={
          <>
            <Status tone="analysis">
              {summary.kindLabel.charAt(0).toUpperCase() +
                summary.kindLabel.slice(1)}
            </Status>
            <span>
              {t('data.analysisPage.savedVersion')} {statistic.version}
            </span>
            <span className="max-lg:hidden">
              {t('data.analysisPage.updated', {
                slice: formatDate(statistic.updated_at),
              })}
            </span>
          </>
        }
        actions={
          <>
            <Button
              icon="link"
              onClick={() => {
                void Promise.resolve()
                  .then(() =>
                    navigator.clipboard.writeText(window.location.href),
                  )
                  .then(() => toast(t('data.analysisPage.linkCopied')))
                  .catch(() =>
                    toast.error(t('data.analysisPage.couldCopyLink')),
                  )
              }}
            >
              {t('common.actions.share')}
            </Button>
            <AskAiButton />
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-4 md:px-6">
        <AnalysisPanel
          standalone
          datasets={sources}
          workspaceId={workspaceId}
          userId={userId}
          initialDatasetId={datasetId}
          onDatasetChange={setDatasetId}
          initialDefinitionId={statistic.id}
        />
      </div>
    </div>
  )
}
