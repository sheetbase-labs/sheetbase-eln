import { useState } from 'react'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import { explainInstruction } from '#/lib/ai-explain-data'
import type { PageAiInput } from '#/lib/page-ai'
import { usePageAi } from '#/lib/use-page-ai'

export type ExplainSubject = 'dataset' | 'chart' | 'analysis'

type State =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'done'; text: string }
  | { phase: 'failed'; message: string }

/**
 * "Explain this" for a dataset, chart or analysis. The facts come from the
 * page (worked out in code); the model only puts them into words. The answer
 * opens in a card beside the button, marked as AI-written, and is never saved
 * anywhere. Renders nothing when AI is off for the workspace.
 */
export function ExplainThis({
  subject,
  facts,
  objectRefs,
  className,
}: {
  subject: ExplainSubject
  /** Plain-text facts about what is on screen; omit to explain from the record itself. */
  facts?: string | null
  objectRefs?: PageAiInput['objectRefs']
  className?: string
}) {
  const ai = usePageAi()
  const [state, setState] = useState<State>({ phase: 'idle' })

  if (!ai.live) return null
  const name = t(`notebook.explainThis.subjects.${subject}`)

  const run = async () => {
    setState({ phase: 'working' })

    const result = await ai.run({
      task: 'explain_data',
      instruction: explainInstruction(
        name,
        facts ?? 'See the attached record.',
      ),
      objectRefs,
    })

    setState(
      result.status === 'ok'
        ? { phase: 'done', text: result.text }
        : { phase: 'failed', message: result.message },
    )
  }

  return (
    <Popover
      onOpenChange={(open) => {
        if (open && state.phase === 'idle') void run()
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="quiet"
            size="sm"
            icon="spark"
            data-testid={`explain-this-${subject}`}
            className={className}
          />
        }
      >
        {t('notebook.explainThis.label')}
      </PopoverTrigger>
      <PopoverContent className="w-[min(26rem,calc(100vw-2rem))] p-4">
        <PopoverTitle className="m-0 text-sm font-semibold">
          {t('notebook.explainThis.title', { subject: name })}
        </PopoverTitle>
        <div className="mt-2 grid gap-3 text-body" aria-live="polite">
          {state.phase === 'working' || state.phase === 'idle' ? (
            <p className="m-0 text-fg-muted">
              {t('notebook.explainThis.working')}
            </p>
          ) : state.phase === 'failed' ? (
            <p className="m-0 text-fg-muted" role="alert">
              {t('notebook.explainThis.failed', { message: state.message })}
            </p>
          ) : (
            <>
              {state.text
                .split(/\n{2,}/)
                .filter(Boolean)
                .map((paragraph) => (
                  <p key={paragraph} className="m-0 whitespace-pre-wrap">
                    {paragraph}
                  </p>
                ))}
              <p className="m-0 text-label text-fg-muted">
                {t('notebook.explainThis.note')}
              </p>
            </>
          )}
          {state.phase === 'done' || state.phase === 'failed' ? (
            <div>
              <Button size="sm" variant="secondary" onClick={() => void run()}>
                {t('notebook.explainThis.again')}
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
