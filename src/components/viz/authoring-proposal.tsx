import { useState } from 'react'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { DraftProposalPanel } from '#/components/assist/draft-proposal-panel'
import { CHART_TYPES } from '#/lib/chart-spec'
import {
  proposeChartSpec,
  proposeChartSpecFromChoice,
} from '#/lib/assist-drafts'
import type { AssistChartProposal } from '#/lib/assist-drafts'
import { usePageAi } from '#/lib/use-page-ai'
import {
  chartSuggestionInstruction,
  parseChartChoice,
} from '#/lib/ai-explain-data'
import type { ChartConfiguratorProps } from './chart-configurator'

/** A proposal remains separate from the controlled spec until acceptance. */
export function AuthoringProposal({
  source,
  onSpecChange,
}: Pick<ChartConfiguratorProps, 'source' | 'onSpecChange'>) {
  const [proposal, setProposal] = useState<AssistChartProposal | null>(null)
  const [status, setStatus] = useState('')
  const [proposing, setProposing] = useState(false)
  const ai = usePageAi()

  async function proposeFromDataset() {
    const fields = source.columns.map((column) => ({
      fieldId: column.id,
      label: column.label,
      logicalType: column.logicalType,
    }))

    let next: AssistChartProposal | null = null

    if (ai.live) {
      setProposing(true)

      try {
        const result = await ai.run({
          task: 'suggest_chart',
          instruction: chartSuggestionInstruction(fields, CHART_TYPES),
        })

        const choice =
          result.status === 'ok'
            ? parseChartChoice(result.text, fields, CHART_TYPES)
            : null

        const type = CHART_TYPES.find((candidate) => candidate === choice?.type)

        if (choice && type)
          next = proposeChartSpecFromChoice({
            datasetId: source.datasetId,
            fields,
            type,
            xFieldId: choice.xFieldId,
            yFieldId: choice.yFieldId,
            reason: choice.reason,
          })
      } finally {
        setProposing(false)
      }
    }

    next ??= proposeChartSpec({ datasetId: source.datasetId, fields })
    setProposal(next)
    setStatus(
      next ? '' : t('data.chartConfigurator.suggestionAvailableTheseFields'),
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" data-print-hide>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={proposing}
          onClick={() => void proposeFromDataset()}
        >
          {proposing
            ? t('data.chartConfigurator.proposingChart')
            : t('data.chartConfigurator.proposeChart')}
        </Button>
        {status ? <p className="text-xs text-fg-muted">{status}</p> : null}
      </div>
      {proposal ? (
        <DraftProposalPanel
          proposal={proposal}
          onAccept={() => {
            onSpecChange(proposal.spec)
            setProposal(null)
          }}
          onDiscard={() => setProposal(null)}
        />
      ) : null}
    </>
  )
}
