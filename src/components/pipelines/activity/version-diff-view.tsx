import { useMemo, useState } from 'react'

import { t } from '#/copy'
import { BoardSegmented } from '#/features/pipelines/board/board'
import { diffVersions, withContext } from '#/lib/pipelines/version-diff'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'
import './activity.css'

type View = 'file' | 'diff'

const MARK = { added: '+', removed: '-', same: ' ' } as const

/** `name:` of a line stays quiet, as on the board's version file. */
function Text({ text }: { text: string }) {
  const found = /^(\s*(?:- )?)([\w.-]+:)(.*)$/.exec(text)

  if (!found) return <>{text}</>

  return (
    <>
      {found[1]}
      <span className="k">{found[2]}</span>
      {found[3]}
    </>
  )
}

/**
 * The text diff an approver reads, as the board draws it (`.pls-vfw`): counts
 * and the Edit | Diff switch above, then the lines with their numbers. Added
 * and removed lines carry + and - as well as colour. Render inside `BoardScope`.
 */
export function VersionDiffView({
  draft,
  published,
}: {
  draft: PipelineDefinitionVersionWire
  published: PipelineDefinitionVersionWire | undefined
}) {
  const [view, setView] = useState<View>('diff')

  const diff = useMemo(
    () => diffVersions(published?.configuration ?? null, draft.configuration),
    [draft.configuration, published?.configuration],
  )

  const shown = useMemo(
    () => withContext(diff, view === 'diff' ? 3 : diff.lines.length),
    [diff, view],
  )

  const against = published
    ? t('features.pipelineApprovals.activity.diffAgainstVersion', {
        version: published.version,
      })
    : t('features.pipelineApprovals.activity.diffAgainstFirst')

  return (
    <section
      className="pls-vfw"
      aria-label={t('features.pipelineApprovals.activity.diffLabel')}
    >
      <div className="pls-atb" style={{ height: 40 }}>
        <span>
          {diff.added + diff.removed === 0
            ? t('features.pipelineApprovals.activity.diffNone')
            : t('features.pipelineApprovals.activity.diffCounts', {
                changed: diff.added + diff.removed,
                added: diff.added,
                removed: diff.removed,
              })}
        </span>
        <span className="mx-sp" />
        <BoardSegmented
          label={t('features.pipelineApprovals.activity.diffView')}
          value={view}
          onChange={(next) => setView(next === 'file' ? 'file' : 'diff')}
          options={[
            {
              value: 'file',
              label: t('features.pipelineApprovals.activity.diffWholeFile'),
            },
            {
              value: 'diff',
              label: t('features.pipelineApprovals.activity.diffTitle', {
                against,
              }),
            },
          ]}
        />
      </div>
      <pre className="pls-yl pls-diff">
        {shown.map((line) =>
          line.kind === 'gap' ? (
            <span key={`gap-${line.n}`} className="l gap">
              {t('features.pipelineApprovals.activity.diffGap', {
                count: line.hidden,
              })}
            </span>
          ) : (
            <span
              key={`${line.kind}-${line.n}`}
              className={
                line.kind === 'added'
                  ? 'l add'
                  : line.kind === 'removed'
                    ? 'l del'
                    : 'l'
              }
              style={{ counterSet: `ln ${line.n - 1}` }}
            >
              {MARK[line.kind]} <Text text={line.text} />
            </span>
          ),
        )}
      </pre>
    </section>
  )
}
