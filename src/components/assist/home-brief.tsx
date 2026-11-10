import { useEffect, useRef, useState } from 'react'

import { Link } from '@tanstack/react-router'

import { Icon } from '#/components/icons'
import { ObjectLink } from '#/components/ui/object-link'
import { Button } from '#/components/ui/button'
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
  HOME_BRIEF_INSTRUCTION,
  homeBriefFacts,
  homeBriefHasFacts,
  linkBrief,
  parseBrief,
} from '#/lib/home-brief'
import type { HomeBriefInput } from '#/lib/home-brief'
import { usePageAi } from '#/lib/use-page-ai'

/** The brief's text, with the records Home named as links that peek. */
function BriefText({ text, input }: { text: string; input: HomeBriefInput }) {
  return (
    <>
      {linkBrief(text, input).map((part, index) =>
        part.kind === 'object' ? (
          <ObjectLink
            key={`object:${part.objectKind}:${part.ref}`}
            kind={part.objectKind}
            id={part.objectKind === 'project' ? part.ref : undefined}
            identifier={part.ref}
            mono={part.objectKind !== 'project'}
          >
            {part.text}
          </ObjectLink>
        ) : part.kind === 'route' ? (
          <Link
            key={`route:${part.to}:${part.text}`}
            to={part.to}
            className="text-link"
          >
            {part.text}
          </Link>
        ) : (
          part.text
        ),
      )}
    </>
  )
}

/**
 * "Brief me" on Home: what needs the person and the next step per project,
 * written from the facts Home already holds. Runs only when asked. Renders
 * nothing when AI is off for the workspace.
 */
export function HomeBrief({
  input,
  ready,
  open,
  onOpenChange,
}: {
  input: HomeBriefInput
  /** False while the projects' counts are still loading. */
  ready: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const ai = usePageAi()
  const [text, setText] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle')
  const askedFor = useRef<string | null>(null)
  const facts = homeBriefFacts(input)

  async function write() {
    askedFor.current = facts
    setState('working')

    const result = await ai
      .run({
        task: 'freeform',
        instruction: HOME_BRIEF_INSTRUCTION,
        text: facts,
      })
      .catch(() => null)

    // A later request replaces askedFor before it resolves, so its result owns
    // the brief text and this one must not write stale output.
    if (askedFor.current !== facts) return

    if (result?.status === 'ok') {
      setText(result.text)
      setState('idle')
    } else {
      setState('failed')
    }
  }

  // Write once when the dialog opens with its facts in; reopening with the same
  // facts keeps the brief that is already there.
  // react-doctor-disable-next-line react-doctor/no-set-state-after-await-in-effect -- write() drops its own late write when a newer request has replaced askedFor, so an overlapping run cannot publish stale text.
  useEffect(() => {
    if (!open || !ready || !homeBriefHasFacts(input)) return

    if (askedFor.current === facts) return
    // react-doctor-disable-next-line react-doctor/no-set-state-after-await-in-effect -- write() guards its own late write: a newer request replaces askedFor, so stale output is dropped.
    void write()
    // react-doctor-disable-next-line react-doctor/exhaustive-deps -- The effect keys on the facts string so a new input identity does not re-request; write() and input are re-read from this render's closure.
  }, [open, ready, facts])

  if (!ai.live) return null

  return (
    <>
      <Button
        type="button"
        variant="quiet"
        icon="spark"
        className="max-md:hidden"
        data-testid="home-brief"
        onClick={() => onOpenChange(true)}
      >
        {t('projects.homeBrief.open')}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[min(560px,calc(100vw-32px))]">
          <DialogHeader
            title={t('projects.homeBrief.title')}
            description={t('projects.homeBrief.description')}
          />
          <DialogBody>
            {ready && !homeBriefHasFacts(input) ? (
              <p className="m-0 text-fg-muted">
                {t('projects.homeBrief.empty')}
              </p>
            ) : state === 'failed' ? (
              <Notice tone="warn">{t('projects.homeBrief.failed')}</Notice>
            ) : text === null || state === 'working' ? (
              <p className="m-0 text-fg-muted">
                {t('projects.homeBrief.working')}
              </p>
            ) : (
              // react-doctor-disable-next-line react-doctor/click-events-have-key-events -- This container only observes anchor activation, and activating a link from the keyboard dispatches the same click event.
              <div
                className="flex flex-col gap-2"
                // Following a record closes the brief; the page opens behind it.
                onClickCapture={(event) => {
                  if (
                    event.target instanceof Element &&
                    event.target.closest('a[href]')
                  )
                    onOpenChange(false)
                }}
              >
                {parseBrief(text).map((block, index) =>
                  block.kind === 'bullet' ? (
                    // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- parseBrief derives an ordered list from one string; a block cannot move without the brief text changing.
                    <p key={index} className="m-0 flex gap-2">
                      <span aria-hidden className="text-fg-muted">
                        •
                      </span>
                      <span>
                        <BriefText text={block.text} input={input} />
                      </span>
                    </p>
                  ) : (
                    // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- Same ordered brief text; the block list has no identity beyond its position.
                    <p key={index} className="m-0 font-medium">
                      <BriefText text={block.text} input={input} />
                    </p>
                  ),
                )}
                <p className="m-0 mt-1 flex items-center gap-1 text-label text-fg-muted">
                  <Icon name="spark" size={12} aria-hidden />
                  {t('projects.homeBrief.label')}
                </p>
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>
              {t('common.actions.close')}
            </DialogClose>
            {text !== null || state === 'failed' ? (
              <Button
                type="button"
                disabled={state === 'working'}
                onClick={() => void write()}
              >
                {t('projects.homeBrief.refresh')}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
