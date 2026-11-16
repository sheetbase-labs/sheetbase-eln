import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { Spinner } from '#/components/ui/spinner'
import { t } from '#/copy'
import { previewUndo, undoChangeSet } from '#/features/ai-undo/client'
import type { UndoPreview, UndoPreviewItem } from '#/features/ai-undo/undo'
import { createDataClient } from '#/lib/data-client'

/**
 * Undo for a card or plan that has run. One button; pressing it shows exactly
 * what would be put back before anything is touched, and the person confirms.
 * When something stops it (signed, locked, changed by someone since, or a kind
 * that cannot be taken back) the panel says what and why, and the undo is not
 * offered: it is all or nothing.
 */

type Phase =
  | { name: 'closed' }
  | { name: 'checking' }
  | { name: 'ready'; preview: UndoPreview }
  | { name: 'refused'; preview: UndoPreview }
  | { name: 'working'; preview: UndoPreview }
  | { name: 'done'; count: number }
  | { name: 'failed'; reason: string }

/** Kept outside the component so a re-render or reopened panel remembers it. */
const remembered = new Map<string, Phase>()

export function UndoPanel({
  setId,
  corner = false,
}: {
  setId: string
  /** Rest as a small button in the top right of the card around it. */
  corner?: boolean
}) {
  const [phase, setPhaseRaw] = useState<Phase>(
    () => remembered.get(setId) ?? { name: 'closed' },
  )

  const queryClient = useQueryClient()
  const router = useRouter()

  function setPhase(next: Phase) {
    if (next.name === 'done' || next.name === 'closed') {
      remembered.set(setId, next)
    }

    setPhaseRaw(next)
  }

  async function check() {
    setPhase({ name: 'checking' })

    try {
      const preview = await previewUndo(createDataClient(), setId)

      if (preview.status === 'undone') {
        setPhase({ name: 'done', count: preview.toUndo })

        return
      }

      setPhase(
        preview.canUndo
          ? { name: 'ready', preview }
          : { name: 'refused', preview },
      )
    } catch (error) {
      setPhase({ name: 'failed', reason: reasonOf(error) })
    }
  }

  async function undo(preview: UndoPreview) {
    setPhase({ name: 'working', preview })

    try {
      const result = await undoChangeSet(createDataClient(), setId)

      if (!result.done) {
        setPhase({ name: 'refused', preview: result.preview })

        return
      }

      setPhase({ name: 'done', count: result.undone ?? preview.toUndo })
      void queryClient.invalidateQueries()
      void router.invalidate()
    } catch (error) {
      setPhase({ name: 'failed', reason: reasonOf(error) })
    }
  }

  if (phase.name === 'closed') {
    return (
      <div
        data-testid="undo-panel"
        data-state="closed"
        className={corner ? 'absolute right-2.5 top-2.5' : undefined}
      >
        <Button size="sm" variant="quiet" onClick={() => void check()}>
          <Icon name="undo" size={12} />
          {t('features.aiUndo.panel.undo')}
        </Button>
      </div>
    )
  }

  if (phase.name === 'checking') {
    return (
      <p
        data-testid="undo-panel"
        data-state="checking"
        className="m-0 inline-flex items-center gap-1.5 text-label text-fg-muted"
      >
        <Spinner size={12} />
        {t('features.aiUndo.panel.checking')}
      </p>
    )
  }

  if (phase.name === 'done') {
    return (
      <p
        data-testid="undo-panel"
        data-state="done"
        className="m-0 inline-flex items-center gap-1.5 text-label text-fg-muted"
      >
        <Icon name="check" size={12} />
        {phase.count > 0
          ? t('features.aiUndo.panel.doneCount', { count: phase.count })
          : t('features.aiUndo.panel.already')}
      </p>
    )
  }

  if (phase.name === 'failed') {
    return (
      <div
        data-testid="undo-panel"
        data-state="failed"
        className="flex flex-col gap-2"
      >
        <p className="m-0 text-label text-danger-text" role="alert">
          {t('features.aiUndo.panel.failed', { reason: phase.reason })}
        </p>
        <div>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => setPhase({ name: 'closed' })}
          >
            {t('features.aiUndo.panel.cancel')}
          </Button>
        </div>
      </div>
    )
  }

  const working = phase.name === 'working'
  const refused = phase.name === 'refused'

  return (
    <section
      data-testid="undo-panel"
      data-state={phase.name}
      aria-label={t('features.aiUndo.panel.undoTitle')}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-2.5"
    >
      <header className="flex items-center gap-2 text-label font-medium text-fg">
        <Icon name={refused ? 'xCircle' : 'undo'} size={12} />
        {refused
          ? t('features.aiUndo.panel.refusedTitle')
          : t('features.aiUndo.panel.undoTitle')}
      </header>
      <p className="m-0 text-label text-fg-muted">
        {refused
          ? t('features.aiUndo.panel.refusedLead')
          : t('features.aiUndo.panel.intro')}
      </p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {phase.preview.items
          .filter((item) => refused || item.state !== 'already')
          .map((item) => (
            <UndoItem key={item.key} item={item} />
          ))}
      </ul>
      {refused ? (
        <div>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => setPhase({ name: 'closed' })}
          >
            {t('features.aiUndo.panel.cancel')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={working}
            onClick={() => void undo(phase.preview)}
          >
            {working ? (
              <>
                <Spinner size={12} />
                {t('features.aiUndo.panel.working')}
              </>
            ) : (
              t('features.aiUndo.panel.confirm')
            )}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            disabled={working}
            onClick={() => setPhase({ name: 'closed' })}
          >
            {t('features.aiUndo.panel.cancel')}
          </Button>
        </div>
      )}
    </section>
  )
}

function UndoItem({ item }: { item: UndoPreviewItem }) {
  const blocked = item.state === 'blocked'

  return (
    <li
      data-item-state={item.state}
      className="flex flex-col gap-0.5 rounded-md bg-surface px-2 py-1.5 text-label"
    >
      <span className="flex items-center gap-2">
        <span className={blocked ? 'text-danger-text' : 'text-fg-muted'}>
          <Icon name={blocked ? 'xCircle' : 'rotateCcw'} size={12} />
        </span>
        <span className="min-w-0 flex-1 text-fg">
          {item.verb ? (
            <span className="text-fg-muted">{item.verb} · </span>
          ) : null}
          <span className="font-medium">{item.label}</span>
        </span>
        {item.href && !blocked ? (
          <a
            href={item.href}
            className="font-medium text-fg underline underline-offset-2"
          >
            {t('features.aiUndo.panel.open')}
          </a>
        ) : null}
      </span>
      {item.changes?.length ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 pl-5 text-fg-muted">
          {item.changes.map((change) => (
            <li key={change.field}>
              <span className="text-fg">{change.field}</span>{' '}
              {change.to ?? t('features.aiUndo.panel.emptyValue')} →{' '}
              <span className="text-fg">
                {change.from ?? t('features.aiUndo.panel.emptyValue')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {blocked && item.reason ? (
        <span className="pl-5 text-danger-text" role="note">
          {item.reason}
        </span>
      ) : null}
    </li>
  )
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A failed undo is a caught throw, untyped by definition; only an Error's message is read.
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : t('common.errors.generic')
}
