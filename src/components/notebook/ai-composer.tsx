import * as React from 'react'
import type { Editor } from '@tiptap/react'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { summariseNotebookBlocks } from '#/lib/assist-drafts'
import { plainTextToRichText } from '#/lib/blocks/plain-text'
import { contextFromPathname } from '#/lib/assistant-context'
import { usePageAi } from '#/lib/use-page-ai'
import type { PageAiTask } from '#/lib/page-ai'
import { useNotebookAiContext } from './notebook-ai-context'

/**
 * "Write with AI" for a notebook text block: draft, rewrite, summarise or write
 * a conclusion from the results. The answer is a suggestion shown under the
 * text; nothing enters the notebook until the person presses Insert or Replace,
 * and it saves like anything else they type.
 */

type Phase =
  | { name: 'idle' }
  | { name: 'working' }
  | { name: 'result'; text: string }
  | { name: 'failed' }

export function AiComposer({
  editor,
  selection,
  onClose,
}: {
  editor: Editor
  /** The text that was selected when the composer opened, if any. */
  selection: string
  onClose: () => void
}) {
  const ai = usePageAi()
  const notebook = useNotebookAiContext()
  const [instruction, setInstruction] = React.useState('')
  const [phase, setPhase] = React.useState<Phase>({ name: 'idle' })
  const inputRef = React.useRef<HTMLInputElement>(null)
  const requestRef = React.useRef(0)

  React.useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const blockText = selection || editor.getText().trim()

  function pageText(): string {
    if (!notebook) return ''

    return summariseNotebookBlocks({
      recordId: notebook.recordId,
      title: notebook.title,
      deepLink: notebook.deepLink,
      blocks: notebook.blocks,
    }).keyPoints.join('\n\n')
  }

  async function run(task: PageAiTask, ask: string, text: string) {
    const request = ++requestRef.current
    setPhase({ name: 'working' })

    const context =
      notebook !== null
        ? ({ kind: 'record', id: notebook.recordId } as const)
        : contextFromPathname(window.location.pathname)

    try {
      const result = await ai.run({
        task,
        instruction: ask,
        text,
        objectRefs: context ? [context] : [],
      })

      if (request !== requestRef.current) return
      setPhase(
        result.status === 'ok' && result.text !== ''
          ? { name: 'result', text: result.text }
          : { name: 'failed' },
      )
    } catch {
      if (request === requestRef.current) setPhase({ name: 'failed' })
    }
  }

  function insert(replace: boolean) {
    if (phase.name !== 'result') return
    const { doc } = plainTextToRichText(phase.text)
    const chain = editor.chain().focus()

    if (replace && !selection) chain.setContent(doc).run()
    else chain.insertContent(doc.content).run()
    onClose()
  }

  const busy = phase.name === 'working'

  const chips: Array<{ label: string; run: () => void }> = [
    {
      label: t('notebook.aiComposer.draftThisPage'),
      run: () =>
        void run(
          'draft',
          t('notebook.aiComposer.draftInstruction'),
          [blockText, pageText()].filter(Boolean).join('\n\n'),
        ),
    },
    ...(blockText
      ? [
          {
            label: selection
              ? t('notebook.aiComposer.rewriteSelection')
              : t('notebook.aiComposer.rewrite'),
            run: () =>
              void run(
                'rewrite',
                instruction.trim() ||
                  t('notebook.aiComposer.rewriteInstruction'),
                blockText,
              ),
          },
        ]
      : []),
    {
      label: t('notebook.aiComposer.summarise'),
      run: () =>
        void run(
          'summarise',
          t('notebook.aiComposer.summariseInstruction'),
          pageText(),
        ),
    },
    {
      label: t('notebook.aiComposer.conclusion'),
      run: () =>
        void run(
          'conclude',
          t('notebook.aiComposer.conclusionInstruction'),
          pageText(),
        ),
    },
  ]

  return (
    <section
      data-testid="ai-composer"
      aria-label={t('notebook.aiComposer.title')}
      className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-surface p-2.5"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-fg-muted">
          <Icon name="spark" size={14} />
        </span>
        <input
          ref={inputRef}
          value={instruction}
          disabled={busy}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && instruction.trim() && !busy) {
              event.preventDefault()
              void run('draft', instruction.trim(), blockText)
            }
          }}
          placeholder={t('notebook.aiComposer.placeholder')}
          aria-label={t('notebook.aiComposer.placeholder')}
          className="min-w-0 flex-1 border-0 bg-transparent text-body text-fg outline-none placeholder:text-fg-faint"
        />
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !instruction.trim()}
          onClick={() => void run('draft', instruction.trim(), blockText)}
        >
          {busy
            ? t('notebook.aiComposer.working')
            : t('notebook.aiComposer.run')}
        </Button>
        <Button
          size="icon"
          variant="quiet"
          aria-label={t('notebook.aiComposer.close')}
          onClick={onClose}
        >
          <Icon name="x" size={14} />
        </Button>
      </div>

      {phase.name === 'result' ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 whitespace-pre-wrap rounded-lg bg-surface-muted px-3 py-2 text-body text-fg">
            {phase.text}
          </p>
          <p className="m-0 text-label text-fg-muted">
            {t('notebook.aiComposer.review')}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => insert(false)}>
              {t('notebook.aiComposer.insert')}
            </Button>
            {blockText ? (
              <Button size="sm" onClick={() => insert(true)}>
                {t('notebook.aiComposer.replace')}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="quiet"
              onClick={() => setPhase({ name: 'idle' })}
            >
              {t('notebook.aiComposer.discard')}
            </Button>
          </div>
        </div>
      ) : phase.name === 'failed' ? (
        <p className="m-0 text-label text-danger-text" role="alert">
          {t('notebook.aiComposer.failed')}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={busy}
              onClick={chip.run}
              className="cursor-pointer rounded-full border border-border bg-surface px-2.5 py-0.5 text-label text-fg hover:bg-surface-hover disabled:cursor-default disabled:opacity-60"
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
