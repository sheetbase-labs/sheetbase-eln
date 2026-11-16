import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Section } from '#/components/ui/layout'
import { Badge } from '#/components/ui/badge'
import { AnalysisBlockPreview } from '#/components/notebook/block-preview'
import { notebookDataClient } from '#/lib/notebook-data'
import { t } from '#/copy'
import { z } from 'zod'

const analysisBlockRow = z.object({
  id: z.string(),
  payload: z.object({ title: z.string().trim().optional() }).loose(),
})

type AnalysisBlockRow = z.infer<typeof analysisBlockRow>

/** The analysis blocks of an experiment's notebook, in the order they appear. */
export function useNotebookAnalysisBlocks(expId: string) {
  return useQuery({
    queryKey: ['ui-port', 'experiment', 'result-analysis-blocks', expId],
    queryFn: async (): Promise<AnalysisBlockRow[]> =>
      z
        .array(analysisBlockRow)
        .parse(
          await notebookDataClient.list(
            'blocks',
            `?record_id=eq.${encodeURIComponent(expId)}&type=eq.analysis&select=id,payload&order=order.asc`,
          ),
        ),
    staleTime: 10_000,
  })
}

function titleOf(row: AnalysisBlockRow): string {
  return row.payload.title || t('projects.expResults.notebookAnalyses.untitled')
}

/**
 * The statistics the notebook holds, drawn from the blocks themselves. A block
 * runs its saved analysis when it is shown, so a figure or number here is the
 * notebook's own and follows it: change the analysis or its data and this tab
 * changes with the notebook, with nothing copied across.
 */
export function NotebookAnalysesSection({ expId }: { expId: string }) {
  const blocks = useNotebookAnalysisBlocks(expId)
  const rows = blocks.data ?? []

  if (rows.length === 0) return null

  return (
    <Section
      title={t('projects.expResults.notebookAnalyses.title')}
      count={rows.length}
    >
      <p className="m-0 mb-3 text-label text-fg-muted">
        {t('projects.expResults.notebookAnalyses.hint')}
      </p>
      <ul className="m-0 flex list-none flex-col gap-4 p-0">
        {rows.map((row) => (
          <li
            key={row.id}
            className="min-w-0 rounded-lg border border-border bg-surface p-3"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-body font-semibold">{titleOf(row)}</h3>
              <div className="flex items-center gap-2">
                <Badge variant="kind">
                  {row.payload.frozen
                    ? t('projects.expResults.notebookAnalyses.frozen')
                    : t('projects.expResults.notebookAnalyses.live')}
                </Badge>
                <Link
                  className="text-label text-link"
                  to="/experiments/$expId/notebook"
                  params={{ expId }}
                  hash={`block-${row.id}`}
                >
                  {t('projects.expResults.notebookAnalyses.open')}
                </Link>
              </div>
            </div>
            <AnalysisBlockPreview payload={row.payload} />
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** The notebook's analyses above a results workspace, in a strip that scrolls on its own. */
export function NotebookAnalysesStrip({ expId }: { expId: string }) {
  const blocks = useNotebookAnalysisBlocks(expId)

  if ((blocks.data?.length ?? 0) === 0) return null

  return (
    <div className="max-h-[55%] shrink-0 overflow-auto px-4 pt-[22px] md:px-8">
      <NotebookAnalysesSection expId={expId} />
    </div>
  )
}
