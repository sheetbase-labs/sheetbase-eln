import { useEffect, useRef, useState } from 'react'

import { parseSequencePayload, sequenceOf } from '#/lib/sequence-block'
import type { SequenceBlockPayload } from '#/lib/sequence-block'
import type { BlockContext } from '#/lib/host'

/** Keeps the block as the host sends it, and sends changes back after a short pause. */
export function useBlockState() {
  const [ready, setReady] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [context, setContext] = useState<BlockContext>({})
  const [draft, setDraft] = useState<SequenceBlockPayload>(() => sequenceOf({}))
  const currentDraft = useRef(draft)
  const sent = useRef('')
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<SequenceBlockPayload | null>(null)
  const blocked = useRef(false)

  useEffect(() => {
    sheetbase.onContext<BlockContext, unknown>((next, state) => {
      setContext(next)
      const incoming = JSON.stringify(state ?? null)
      const parsed = parseSequencePayload(state)

      if (!parsed.success) {
        blocked.current = true
        window.clearTimeout(timer.current)
        pending.current = null
        setInvalid(true)
        setReady(true)

        return
      }

      // A host echo must not overwrite edits that are still pending.
      if (!blocked.current && (incoming === sent.current || pending.current)) {
        setReady(true)

        return
      }

      blocked.current = false
      setInvalid(false)
      sent.current = incoming
      const nextDraft = parsed.data
      currentDraft.current = nextDraft
      setDraft(nextDraft)
      setReady(true)
    })
  }, [])

  const flush = () => {
    window.clearTimeout(timer.current)
    const next = pending.current

    if (!next) return
    pending.current = null
    sent.current = JSON.stringify(next)
    sheetbase.setState(next)
  }

  const change = (
    fn: (current: SequenceBlockPayload) => SequenceBlockPayload,
  ) => {
    if (blocked.current) return
    const next = fn(currentDraft.current)
    currentDraft.current = next
    pending.current = next
    setDraft(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 500)
  }

  useEffect(() => {
    const leave = () => flush()
    window.addEventListener('pagehide', leave)

    return () => window.removeEventListener('pagehide', leave)
  }, [])

  return { ready, invalid, context, draft, change, flush }
}
