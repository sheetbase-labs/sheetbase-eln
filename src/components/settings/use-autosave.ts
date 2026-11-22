import { useEffect, useRef, useState } from 'react'

import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'

/** How long typing pauses before a text change is saved. Choices and ticks
 * change the draft once, so they save after the same short wait. */
const SAVE_AFTER_MS = 700

/**
 * Saves a settings form the moment it changes, so a page has no Save button.
 *
 * The page keeps its own draft state. When the draft differs from what is
 * saved, is valid, and has been still for a moment, `save` runs; a toast says
 * "Saved" with Undo, which puts the form back to what it was and saves that.
 * A failed save keeps the draft on screen, says why, and tries again only
 * after the next edit. Leaving the page flushes an edit that has not saved yet.
 */
export function useAutoSave<T>({
  draft,
  saved,
  equal,
  valid = true,
  save,
  restore,
  message,
}: {
  draft: T
  /** What the server holds; undefined until it has loaded. */
  saved: T | undefined
  equal: (a: T, b: T) => boolean
  valid?: boolean
  /** Stores the draft; rejects with the reason it was refused. */
  save: (draft: T) => Promise<void>
  /** Puts the form back to a value (used by Undo). */
  restore: (value: T) => void
  /** The toast on success; defaults to "Saved". */
  message?: string
}) {
  const [pending, setPending] = useState(false)
  const failed = useRef<T | null>(null)
  const done = useRef<T | null>(null)
  const undoing = useRef(false)
  const inFlight = useRef(false)

  const latest = useRef({ draft, saved, save, restore, message })

  // Kept current after every render so a delayed save sees the newest values.
  useEffect(() => {
    latest.current = { draft, saved, save, restore, message }
  })

  const dirty = saved !== undefined && !equal(draft, saved)

  const run = useRef(async () => {
    const current = latest.current
    const next = current.draft
    const before = current.saved

    if (inFlight.current || before === undefined) return

    inFlight.current = true
    setPending(true)

    const wasUndo = undoing.current

    undoing.current = false

    try {
      await current.save(next)

      failed.current = null
      done.current = next

      toast(current.message ?? t('settings.page.savedToast'), {
        action: wasUndo
          ? undefined
          : {
              label: t('common.actions.undo'),
              onClick: () => {
                undoing.current = true
                current.restore(before)
              },
            },
      })
    } catch (error) {
      failed.current = next

      toast.error(
        error instanceof Error
          ? error.message
          : t('settings.page.couldNotSave'),
      )
    } finally {
      inFlight.current = false
      setPending(false)
    }
  })

  useEffect(() => {
    if (!dirty || !valid || pending) return

    if (draft === failed.current || draft === done.current) return

    const timer = setTimeout(() => void run.current(), SAVE_AFTER_MS)

    return () => clearTimeout(timer)
  }, [dirty, valid, pending, draft])

  // An edit still waiting out its pause is saved when the page is left.
  const flush = useRef(false)

  useEffect(() => {
    flush.current =
      dirty &&
      valid &&
      !pending &&
      draft !== failed.current &&
      draft !== done.current
  })

  useEffect(
    () => () => {
      if (flush.current) void run.current()
    },
    [],
  )

  return { pending, dirty }
}
