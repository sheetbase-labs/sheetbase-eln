import { useState } from 'react'

import { Button } from '#/components/ui/button'
import { Field } from '#/components/ui/input'
import { Notice } from '#/components/ui/alert'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { t } from '#/copy'
import {
  STEPS_INSTRUCTION,
  buildStepsText,
  parseSteps,
} from '#/lib/assist-steps'
import { usePageAi } from '#/lib/use-page-ai'

const AREA =
  'w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-body text-fg placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus'

/**
 * "Draft steps" for a protocol being written. The draft is a list the person
 * edits before adding; nothing reaches the document until they choose to.
 * Renders nothing when AI is off for the workspace.
 */
export function DraftStepsButton({
  recordId,
  title,
  onAdd,
}: {
  recordId: string
  title: string
  /** Add these steps to the document, in order. */
  onAdd: (steps: string[]) => Promise<void>
}) {
  const ai = usePageAi()
  const [open, setOpen] = useState(false)
  const [brief, setBrief] = useState('')
  const [draft, setDraft] = useState('')

  const [state, setState] = useState<'idle' | 'working' | 'failed' | 'adding'>(
    'idle',
  )

  if (!ai.live) return null

  const steps = parseSteps(draft)

  async function write() {
    setState('working')

    const result = await ai
      .run({
        task: 'draft',
        instruction: STEPS_INSTRUCTION,
        text: buildStepsText(title, brief),
        objectRefs: [{ kind: 'record', id: recordId }],
      })
      .catch(() => null)

    if (result?.status === 'ok' && parseSteps(result.text).length > 0) {
      setDraft(parseSteps(result.text).join('\n'))
      setState('idle')
    } else {
      setState('failed')
    }
  }

  async function add() {
    setState('adding')

    try {
      await onAdd(steps)
      setOpen(false)
      setDraft('')
      setBrief('')
      setState('idle')
    } catch {
      setState('failed')
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="quiet"
        size="sm"
        icon="spark"
        data-testid="draft-steps"
        onClick={() => setOpen(true)}
      >
        {t('library.protocols.draftSteps.open')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(560px,calc(100vw-32px))]">
          <DialogHeader
            title={t('library.protocols.draftSteps.title')}
            description={t('library.protocols.draftSteps.description')}
          />
          <DialogBody>
            <Field label={t('library.protocols.draftSteps.briefLabel')}>
              <textarea
                className={AREA}
                rows={3}
                value={brief}
                placeholder={t('library.protocols.draftSteps.briefPlaceholder')}
                onChange={(event) => setBrief(event.target.value)}
              />
            </Field>
            <div>
              <Button
                type="button"
                size="sm"
                icon="spark"
                disabled={state === 'working' || state === 'adding'}
                onClick={() => void write()}
              >
                {state === 'working'
                  ? t('library.protocols.draftSteps.writing')
                  : draft
                    ? t('library.protocols.draftSteps.again')
                    : t('library.protocols.draftSteps.write')}
              </Button>
            </div>
            {draft ? (
              <Field
                label={t('library.protocols.draftSteps.stepsLabel')}
                hint={t('library.protocols.draftSteps.stepsHint')}
              >
                <textarea
                  className={AREA}
                  rows={Math.min(14, Math.max(5, steps.length + 1))}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </Field>
            ) : null}
            {state === 'failed' ? (
              <Notice tone="warn">
                {t('library.protocols.draftSteps.failed')}
              </Notice>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              type="button"
              variant="primary"
              disabled={steps.length === 0 || state === 'adding'}
              onClick={() => void add()}
            >
              {steps.length === 0
                ? t('library.protocols.draftSteps.addNone')
                : t('library.protocols.draftSteps.add', {
                    count: steps.length,
                  })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
