import { useMemo } from 'react'

import { t } from '#/copy'
import { cn } from '#/lib/utils'
import { diffVersions, withContext } from '#/lib/pipelines/version-diff'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'

/**
 * The text diff an approver reads: the draft written out as text against the
 * published version (or against nothing for a first version). Added lines are
 * marked with + and removed with −, so colour is never the only cue.
 */
export function VersionDiffView({
  draft,
  published,
}: {
  draft: PipelineDefinitionVersionWire
  published: PipelineDefinitionVersionWire | undefined
}) {
  const diff = useMemo(
    () => diffVersions(published?.configuration ?? null, draft.configuration),
    [draft.configuration, published?.configuration],
  )

  const shown = useMemo(() => withContext(diff, 3), [diff])

  const against = published
    ? t('features.pipelineApprovals.activity.diffAgainstVersion', {
        version: published.version,
      })
    : t('features.pipelineApprovals.activity.diffAgainstFirst')

  return (
    <section
      aria-label={t('features.pipelineApprovals.activity.diffLabel')}
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-label">
        <span>
          {diff.added + diff.removed === 0
            ? t('features.pipelineApprovals.activity.diffNone')
            : t('features.pipelineApprovals.activity.diffCounts', {
                changed: diff.added + diff.removed,
                added: diff.added,
                removed: diff.removed,
              })}
        </span>
        <span className="ml-auto rounded-md border border-border bg-surface-muted px-2 py-0.5 text-fg-muted">
          {t('features.pipelineApprovals.activity.diffTitle', { against })}
        </span>
      </header>
      <pre className="m-0 max-h-[28rem] overflow-auto py-1 font-mono text-[12px] leading-[18px]">
        {shown.map((line, index) =>
          line.kind === 'gap' ? (
            <div
              key={index}
              className="px-3 text-fg-faint"
              aria-label={t('features.pipelineApprovals.activity.diffGap', {
                count: line.hidden,
              })}
            >
              ⋯{' '}
              {t('features.pipelineApprovals.activity.diffGap', {
                count: line.hidden,
              })}
            </div>
          ) : (
            <div
              key={index}
              className={cn(
                'whitespace-pre px-3',
                line.kind === 'added' && 'bg-success-wash',
                line.kind === 'removed' && 'bg-danger-wash text-fg-muted',
              )}
            >
              <span
                aria-hidden="true"
                className="mr-3 inline-block w-5 select-none text-right text-fg-faint"
              >
                {line.n}
              </span>
              <span aria-hidden="true" className="select-none text-fg-faint">
                {line.kind === 'added'
                  ? '+ '
                  : line.kind === 'removed'
                    ? '− '
                    : '  '}
              </span>
              {line.text}
            </div>
          ),
        )}
      </pre>
    </section>
  )
}
