import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Banner } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { toast } from '#/components/v3/ui/sonner'
import {
  describeBulkOutcome,
  summariseBulkUpgrade,
  upgradeNotebooksInBulk,
} from '#/lib/notebook-template-bulk-upgrade'
import type {
  BulkUpgradeNotebook,
  BulkUpgradeOutcome,
  BulkUpgradeResult,
} from '#/lib/notebook-template-bulk-upgrade'
import { notebookTemplateDataClient } from '#/lib/notebook-template-data'

const TONE: Record<BulkUpgradeOutcome['kind'], Tone> = {
  updated: 'ok',
  'needs-decision': 'warn',
  signed: 'stored',
  failed: 'bad',
}

/**
 * Take a published template version into every notebook that can take it, in
 * one pass. Notebooks that need a decision are listed with a Review link
 * instead of being decided for the owner.
 */
export function BulkUpgradePanel({
  templateId,
  targetVersion,
  targetVersionId,
  notebooks,
}: {
  templateId: string
  targetVersion: number
  targetVersionId: string
  notebooks: readonly BulkUpgradeNotebook[]
}) {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<number | null>(null)
  const [results, setResults] = useState<BulkUpgradeResult[] | null>(null)

  const run = useMutation({
    mutationFn: () => {
      setResults(null)
      setProgress(0)
      return upgradeNotebooksInBulk(
        notebookTemplateDataClient,
        { notebooks, targetVersionId },
        (done) => setProgress(done),
      )
    },
    onSuccess: async (out) => {
      setResults(out)
      setProgress(null)
      const summary = summariseBulkUpgrade(out)
      toast(
        `${summary.updated} of ${out.length} notebooks updated to v${targetVersion}`,
        {
          description:
            summary.needsDecision + summary.signed + summary.failed > 0
              ? 'The rest are listed with what each needs.'
              : 'Each is recorded in its history as a template update.',
        },
      )
      await queryClient.invalidateQueries({
        queryKey: ['ui-port', 'templates'],
      })
    },
    onError: (error: unknown) => {
      setProgress(null)
      toast.error(
        error instanceof Error ? error.message : 'The update did not finish.',
      )
    },
  })

  const left = results?.filter((r) => r.outcome.kind !== 'updated') ?? []
  return (
    <div className="flex max-w-[760px] flex-col gap-3 pb-3">
      <Banner
        tone="info"
        icon="template"
        title={`Update ${notebooks.length} ${
          notebooks.length === 1 ? 'notebook' : 'notebooks'
        } to v${targetVersion} in one pass.`}
        action={
          <Button
            size="sm"
            variant="primary"
            disabled={run.isPending || notebooks.length === 0}
            onClick={() => run.mutate()}
          >
            {run.isPending
              ? `Updating ${progress ?? 0} of ${notebooks.length}…`
              : `Update all to v${targetVersion}`}
          </Button>
        }
      >
        Notebooks with nothing to decide are updated now. Any that need your
        decision on a sheet, or that are signed, are left as they are and listed
        below.
      </Banner>
      {left.length > 0 ? (
        <ul
          aria-label="Notebooks that were not updated"
          className="m-0 flex list-none flex-col gap-1 p-0"
        >
          {left.map(({ notebook, outcome }) => (
            <li
              key={notebook.id}
              className="flex flex-wrap items-center gap-3 text-label"
            >
              <ObjectLink
                kind="experiment"
                id={notebook.id}
                identifier={notebook.identifier}
              />
              <Status tone={TONE[outcome.kind]}>
                {describeBulkOutcome(outcome)}
              </Status>
              {outcome.kind === 'needs-decision' ? (
                <Link
                  to="/templates/$templateId/update"
                  params={{ templateId }}
                  search={{ record: notebook.id }}
                  className="text-link"
                >
                  Review v{targetVersion}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
