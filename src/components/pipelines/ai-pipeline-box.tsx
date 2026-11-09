import { useState } from 'react'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { CodeBlock } from '#/components/ui/code-block'
import { Field } from '#/components/ui/input'
import { fetchPipelineDraftContext } from '#/components/pipelines/pipelines-data'
import {
  parsePipelineDraftAnswer,
  pipelineDraftInstruction,
} from '#/lib/ai-pipeline-draft'
import type {
  CurrentPipelineDraft,
  PipelineDraftProposal,
} from '#/lib/ai-pipeline-draft'
import { notebookDataClient } from '#/lib/notebook-data'
import { usePageAi } from '#/lib/use-page-ai'

type BoxState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'ready'; proposal: PipelineDraftProposal }
  | { phase: 'applying'; proposal: PipelineDraftProposal }
  | { phase: 'applied' }
  | { phase: 'failed'; text: string }

/**
 * Describe a pipeline in plain English. The draft comes back as a card: what it
 * reads, what it does and where the result goes. Nothing is written until the
 * person chooses Apply, which puts it into the draft version. Publishing is a
 * separate step the person takes. Renders nothing unless a real model is
 * connected.
 */
export function AiPipelineBox({
  current,
  onApply,
}: {
  current: CurrentPipelineDraft
  /** Write the draft into the draft version; rejects with the reason if it cannot. */
  onApply: (proposal: PipelineDraftProposal) => Promise<void>
}) {
  const ai = usePageAi()
  const [text, setText] = useState('')
  const [state, setState] = useState<BoxState>({ phase: 'idle' })

  if (!ai.live) return null

  const hasWork =
    (current.inputs ?? []).length > 0 ||
    (current.steps ?? []).length > 0 ||
    Boolean(
      current.statement?.trim() &&
      current.statement.trim() !== 'select * from previous',
    )

  async function draft() {
    setState({ phase: 'running' })

    try {
      const context = await fetchPipelineDraftContext(notebookDataClient)

      const result = await ai.run({
        task: 'draft_pipeline',
        instruction: pipelineDraftInstruction(text, context, current),
      })

      if (result.status !== 'ok') {
        setState({
          phase: 'failed',
          text: t('data.pipelineAi.failed', { message: result.message }),
        })

        return
      }

      const proposal = parsePipelineDraftAnswer(result.text, context)
      setState(
        proposal
          ? { phase: 'ready', proposal }
          : { phase: 'failed', text: t('data.pipelineAi.nothing') },
      )
    } catch (error) {
      setState({
        phase: 'failed',
        text: t('data.pipelineAi.failed', {
          message: error instanceof Error ? error.message : '',
        }),
      })
    }
  }

  async function apply(proposal: PipelineDraftProposal) {
    setState({ phase: 'applying', proposal })

    try {
      await onApply(proposal)
      setState({ phase: 'applied' })
      setText('')
    } catch (error) {
      setState({
        phase: 'failed',
        text: t('data.pipelineAi.applyFailed', {
          message: error instanceof Error ? error.message : '',
        }),
      })
    }
  }

  const proposal =
    state.phase === 'ready' || state.phase === 'applying'
      ? state.proposal
      : null

  return (
    <section
      aria-label={t('data.pipelineAi.label')}
      data-testid="pipeline-ai-box"
      className="flex flex-col gap-3 border-b border-border px-4 py-3"
    >
      <Field
        label={t('data.pipelineAi.label')}
        hint={t('data.pipelineAi.hint')}
      >
        <textarea
          aria-label={t('data.pipelineAi.label')}
          value={text}
          rows={2}
          maxLength={4000}
          placeholder={t('data.pipelineAi.placeholder')}
          onChange={(event) => setText(event.target.value)}
          className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-2 text-body text-fg placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-accent"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          icon="spark"
          data-testid="pipeline-ai-draft"
          disabled={
            !text.trim() || state.phase === 'running' || proposal !== null
          }
          onClick={() => void draft()}
        >
          {state.phase === 'running'
            ? t('data.pipelineAi.working')
            : hasWork
              ? t('data.pipelineAi.revise')
              : t('data.pipelineAi.draft')}
        </Button>
        {state.phase === 'applied' ? (
          <span className="text-label text-fg-muted" role="status">
            {t('data.pipelineAi.applied')}
          </span>
        ) : null}
        {state.phase === 'failed' ? (
          <span className="text-label text-fg-muted" role="status">
            {state.text}
          </span>
        ) : null}
      </div>
      {proposal ? (
        <div
          role="group"
          aria-label={t('data.pipelineAi.cardLabel')}
          data-testid="pipeline-ai-card"
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
        >
          <span className="text-label text-fg-muted">
            {t('data.pipelineAi.cardLabel')}
          </span>
          {proposal.summary ? (
            <p className="m-0 text-body font-medium text-fg">
              {proposal.summary}
            </p>
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label text-fg">
            {proposal.lines.map((line) => (
              <li
                key={line}
                className="rounded-lg bg-surface-muted px-2.5 py-1.5"
              >
                {line}
              </li>
            ))}
          </ul>
          {[
            proposal.config.transform.statement,
            ...proposal.config.steps.map((s) => s.statement),
          ].map((statement, index) => (
            <CodeBlock
              key={index}
              code={statement}
              language="sql"
              label={`${t('data.pipelineAi.sqlLabel')} ${index + 1}`}
              maxHeight="sm"
            />
          ))}
          {proposal.skipped.length > 0 ? (
            <p className="m-0 text-label text-fg-muted">
              {t('data.pipelineAi.skipped', {
                items: proposal.skipped.join('; '),
              })}
            </p>
          ) : null}
          {hasWork ? (
            <p className="m-0 text-label text-fg-muted">
              {t('data.pipelineAi.replaces')}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              data-testid="pipeline-ai-apply"
              disabled={state.phase === 'applying'}
              onClick={() => void apply(proposal)}
            >
              {state.phase === 'applying'
                ? t('data.pipelineAi.applying')
                : t('data.pipelineAi.apply')}
            </Button>
            <Button
              size="sm"
              variant="quiet"
              disabled={state.phase === 'applying'}
              onClick={() => setState({ phase: 'idle' })}
            >
              {t('data.pipelineAi.dismiss')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
