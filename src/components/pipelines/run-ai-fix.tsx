import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { toast } from '#/components/ui/sonner'
import { usePageAi } from '#/lib/use-page-ai'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  FIX_INSTRUCTION,
  TRANSFORM_TARGET,
  applyStepFix,
  buildFixText,
  parseFailureReply,
  statementOf,
} from '#/lib/pipelines/ai-fix'
import type { FailureExplanation } from '#/lib/pipelines/ai-fix'
import {
  createPipelineDefinitionVersion,
  updatePipelineDefinitionVersionDraft,
} from '#/lib/pipelines/data'
import type { PipelineConfig } from '#/lib/pipelines/config'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'

/**
 * On a failed run: AI explains the error and, when a code change would fix it,
 * proposes one corrected step as an Apply / Dismiss card. Apply writes the
 * draft version (or creates the first one). It never publishes, and it is
 * hidden when AI is off or only the built-in model is connected.
 */

type Phase =
  | { name: 'idle' }
  | { name: 'asking' }
  | { name: 'error'; message: string }
  | { name: 'answer'; answer: FailureExplanation }
  | { name: 'applied'; created: boolean }
  | { name: 'dismissed' }

export function RunAiFix({
  pipelineId,
  errorCode,
  errorMessage,
  logLines,
  failedStep,
  runConfig,
  draft,
}: {
  pipelineId: string
  errorCode: string | null
  errorMessage: string | null
  /** The run's error-level log lines, oldest first. */
  logLines: string[]
  /** The step the run stopped on ('Transform' or a step name), when known. */
  failedStep: string | null
  /** The configuration of the version the run used. */
  runConfig: Partial<PipelineConfig>
  draft: PipelineDefinitionVersionWire | undefined
}) {
  const ai = usePageAi()
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })

  const workspaceId = ai.workspaceId ?? ''

  const apply = useMutation({
    mutationFn: async (fix: NonNullable<FailureExplanation['fix']>) => {
      const base = (draft?.configuration ?? runConfig) as PipelineConfig
      const next = applyStepFix(base, fix)

      if (!next.ok) throw new Error(next.reason)

      if (draft) {
        await updatePipelineDefinitionVersionDraft(notebookDataClient, {
          workspaceId,
          versionId: draft.id,
          expectedRevision: Number(draft.revision),
          configuration: next.config as unknown as Record<string, unknown>,
        })

        return false
      }

      await createPipelineDefinitionVersion(notebookDataClient, {
        workspaceId,
        definitionId: pipelineId,
        configuration: next.config as unknown as Record<string, unknown>,
      })

      return true
    },
    onSuccess: (created) => {
      setPhase({ name: 'applied', created })
      toast(
        created
          ? t('data.pipelineRunAiFix.appliedCreate')
          : t('data.pipelineRunAiFix.appliedUpdate'),
      )
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'pipelines'] })
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : ''
      setPhase({
        name: 'error',
        message: /revision|stale|conflict/i.test(message)
          ? t('data.pipelineRunAiFix.stale')
          : t('data.pipelineRunAiFix.cantApply', { reason: message }),
      })
    },
  })

  // Off, not ready, or only the built-in model (it can't read code): no card.
  if (!ai.available || !ai.live) return null

  async function ask() {
    setPhase({ name: 'asking' })

    try {
      const result = await ai.run({
        task: 'freeform',
        instruction: FIX_INSTRUCTION,
        text: buildFixText({
          errorCode,
          errorMessage,
          logLines,
          failedStep,
          config: runConfig,
        }),
      })

      if (result.status !== 'ok') {
        setPhase({
          name: 'error',
          message: t('data.pipelineRunAiFix.failed', {
            reason: result.message,
          }),
        })

        return
      }

      const answer = parseFailureReply(result.text, runConfig)
      setPhase(
        answer
          ? { name: 'answer', answer }
          : { name: 'error', message: t('data.pipelineRunAiFix.badReply') },
      )
    } catch (error) {
      setPhase({
        name: 'error',
        message: t('data.pipelineRunAiFix.failed', {
          reason: error instanceof Error ? error.message : '',
        }),
      })
    }
  }

  if (phase.name === 'dismissed') return null
  const fix = phase.name === 'answer' ? phase.answer.fix : null
  const before = fix ? statementOf(runConfig, fix.target) : null

  return (
    <section
      data-testid="run-ai-fix"
      aria-label={t('data.pipelineRunAiFix.heading')}
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
    >
      <header className="flex items-start gap-2">
        <span className="mt-0.5 text-fg-muted">
          <Icon name="spark" size={14} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="m-0 font-sans text-label font-semibold">
            {phase.name === 'answer' && fix
              ? t('data.pipelineRunAiFix.suggestionIn', {
                  step:
                    fix.target === TRANSFORM_TARGET
                      ? t('data.pipelineRunAiFix.transform')
                      : fix.target,
                })
              : t('data.pipelineRunAiFix.heading')}
          </h3>
        </div>
      </header>

      {phase.name === 'idle' || phase.name === 'asking' ? (
        <>
          <p className="m-0 text-label text-fg-muted">
            {t('data.pipelineRunAiFix.intro')}
          </p>
          <div>
            <Button
              size="sm"
              variant="primary"
              disabled={phase.name === 'asking'}
              onClick={() => void ask()}
            >
              {phase.name === 'asking'
                ? t('data.pipelineRunAiFix.asking')
                : t('data.pipelineRunAiFix.ask')}
            </Button>
          </div>
        </>
      ) : null}

      {phase.name === 'error' ? (
        <>
          <p className="m-0 text-label text-danger-text" role="alert">
            {phase.message}
          </p>
          <div>
            <Button size="sm" onClick={() => void ask()}>
              {t('data.pipelineRunAiFix.tryAgain')}
            </Button>
          </div>
        </>
      ) : null}

      {phase.name === 'answer' ? (
        <>
          <p className="m-0 whitespace-pre-line text-body text-fg">
            {phase.answer.explanation}
          </p>
          {fix && before ? (
            <div className="flex flex-col gap-1.5">
              <CodeBlock
                label={t('data.pipelineRunAiFix.before')}
                code={before.statement}
                tone="before"
              />
              <CodeBlock
                label={t('data.pipelineRunAiFix.after')}
                code={fix.statement}
                tone="after"
              />
            </div>
          ) : (
            <p className="m-0 text-label text-fg-muted">
              {t('data.pipelineRunAiFix.noCodeFix')}
            </p>
          )}
          <p className="m-0 text-label text-fg-faint">
            {t('data.pipelineRunAiFix.generated')}
          </p>
          <div className="flex items-center gap-2">
            {fix ? (
              <Button
                size="sm"
                variant="primary"
                disabled={apply.isPending}
                onClick={() => apply.mutate(fix)}
              >
                {apply.isPending
                  ? t('data.pipelineRunAiFix.applying')
                  : t('data.pipelineRunAiFix.apply')}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="quiet"
              disabled={apply.isPending}
              onClick={() => setPhase({ name: 'dismissed' })}
            >
              {t('data.pipelineRunAiFix.dismiss')}
            </Button>
          </div>
        </>
      ) : null}

      {phase.name === 'applied' ? (
        <div className="flex items-center gap-3 text-label text-fg-muted">
          <span className="inline-flex items-center gap-1">
            <Icon name="check" size={12} />
            {t('data.pipelineRunAiFix.applied')}
          </span>
          <Link
            to="/pipelines/$pipelineId/steps"
            params={{ pipelineId }}
            className="font-medium text-fg underline underline-offset-2"
          >
            {t('data.pipelineRunAiFix.openDraft')}
          </Link>
        </div>
      ) : null}
    </section>
  )
}

function CodeBlock({
  label,
  code,
  tone,
}: {
  label: string
  code: string
  tone: 'before' | 'after'
}) {
  return (
    <div
      className={
        tone === 'before'
          ? 'rounded-lg bg-danger-wash px-2.5 py-2'
          : 'rounded-lg bg-surface-muted px-2.5 py-2'
      }
    >
      <span className="text-label font-medium text-fg-muted">{label}</span>
      <pre className="m-0 mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-label text-fg">
        {code}
      </pre>
    </div>
  )
}
