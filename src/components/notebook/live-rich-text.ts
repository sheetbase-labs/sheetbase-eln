/**
 * Live co-editing for a rich text block.
 *
 * While two or more people have a block open they edit one shared document (a
 * Yjs fragment held by the room) instead of each keeping a private draft. The
 * database stays the authority: every editor still saves the block through the
 * ordinary autosave path, and the shared document is thrown away when the last
 * person leaves. A new session seeds it from the saved block.
 *
 * Nothing here runs unless a room is joined, the person may write in it, and
 * the person has not already started typing locally.
 */
import * as React from 'react'
import { getSchema } from '@tiptap/react'
import type { Extensions } from '@tiptap/react'
import {
  prosemirrorJSONToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from '@tiptap/y-tiptap'
import type * as Y from 'yjs'

import type { CollabProvider } from '#/lib/collaboration/provider'
import {
  useRoomConnection,
  useRoomProvider,
} from '#/lib/collaboration/room-hooks'
import type { RichTextDocument } from '#/lib/blocks/rich-text'

/** The shared fragment a block's text lives in. */
export function liveFieldName(blockId: string): string {
  return `block:${blockId}`
}

function isSeeded(doc: Y.Doc, blockId: string): boolean {
  return (
    doc.getXmlFragment(liveFieldName(blockId)).length > 0 ||
    doc.getMap('seeded').has(blockId)
  )
}

/** Put the saved content into the shared document, once, atomically. */
export function seedFragment(
  provider: CollabProvider,
  blockId: string,
  extensions: Extensions,
  saved: RichTextDocument,
): void {
  const { doc } = provider
  doc.transact(() => {
    if (isSeeded(doc, blockId)) return
    prosemirrorJSONToYXmlFragment(
      getSchema(extensions),
      saved,
      doc.getXmlFragment(liveFieldName(blockId)),
    )
    doc.getMap('seeded').set(blockId, true)
  })
}

/** A short fingerprint of a document, for telling states apart cheaply. */
export function fingerprint(json: unknown): string {
  const text = JSON.stringify(json)
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  }
  return `${text.length}:${hash}`
}

/** True when the shared copy of a block already says what `saved` says. */
export function fragmentMatches(
  doc: Y.Doc,
  blockId: string,
  extensions: Extensions,
  saved: RichTextDocument,
): boolean {
  const schema = getSchema(extensions)
  const shared = yXmlFragmentToProseMirrorRootNode(
    doc.getXmlFragment(liveFieldName(blockId)),
    schema,
  ).toJSON()
  return (
    fingerprint(shared) === fingerprint(schema.nodeFromJSON(saved).toJSON())
  )
}

/**
 * Replace a shared block's text with the saved copy. Only safe while nobody
 * else has the block open: it swaps the whole text, which would trample a
 * collaborator mid-sentence.
 */
export function reseedFragment(
  provider: CollabProvider,
  blockId: string,
  extensions: Extensions,
  saved: RichTextDocument,
): void {
  const { doc } = provider
  doc.transact(() => {
    const fragment = doc.getXmlFragment(liveFieldName(blockId))
    fragment.delete(0, fragment.length)
    prosemirrorJSONToYXmlFragment(getSchema(extensions), saved, fragment)
    doc.getMap('seeded').set(blockId, true)
  })
}

export interface LiveRichText {
  /** The editor should bind to the shared document. */
  live: boolean
  provider: CollabProvider | null
}

/**
 * Decides when a block's editor switches from its private draft to the shared
 * document, and makes sure the shared document holds the block's text first so
 * the switch never flashes an empty page.
 *
 * @param extensions  the editor's content extensions (they define the schema)
 * @param getSaved    the block's current text, read when this person seeds it
 * @param edited      true once this person has typed: they keep their draft
 */
export function useLiveRichText({
  blockId,
  extensions,
  getSaved,
  edited,
}: {
  blockId: string | undefined
  extensions: Extensions
  getSaved: () => RichTextDocument
  edited: () => boolean
}): LiveRichText {
  const provider = useRoomProvider()
  const { synced, canWrite } = useRoomConnection()
  const [liveFor, setLiveFor] = React.useState<CollabProvider | null>(null)
  const latest = React.useRef({ extensions, getSaved, edited })
  latest.current = { extensions, getSaved, edited }

  React.useEffect(() => {
    if (!blockId || !provider || !synced || !canWrite) return
    if (liveFor === provider) return
    // Someone who has already started typing keeps their draft for now: the
    // shared document would replace what they typed.
    if (latest.current.edited()) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const { doc } = provider

    const finish = () => {
      // Seeding takes a round trip. If the person started typing meanwhile,
      // switching now would replace their new text with the saved copy.
      if (!cancelled && !latest.current.edited()) setLiveFor(provider)
    }
    const onTransaction = () => {
      if (isSeeded(doc, blockId)) {
        stopWatching()
        finish()
      }
    }
    const stopWatching = () => {
      doc.off('afterTransaction', onTransaction)
      if (timer) clearTimeout(timer)
    }

    const attempt = async (retriesLeft: number) => {
      if (cancelled) return
      if (isSeeded(doc, blockId)) {
        // The room can outlive its last editor by a moment. If this person is
        // the only one here and the block was saved differently in between
        // (another tool, an import, an assistant action), start again from the
        // saved copy rather than resurrect stale text.
        const alone = provider.awareness.getStates().size <= 1
        const saved = latest.current.getSaved()
        if (
          alone &&
          !fragmentMatches(doc, blockId, latest.current.extensions, saved)
        ) {
          reseedFragment(provider, blockId, latest.current.extensions, saved)
        }
        return finish()
      }
      const granted = await provider.claimSeed(blockId)
      // The effect may have been cleaned up while the claim was in flight.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (cancelled) {
        if (granted) provider.releaseSeed(blockId)
        return
      }
      if (granted) {
        seedFragment(
          provider,
          blockId,
          latest.current.extensions,
          latest.current.getSaved(),
        )
        return finish()
      }
      // Someone else is seeding it: wait for their content to arrive, and ask
      // again if it does not (they may have closed the block first).
      doc.on('afterTransaction', onTransaction)
      timer = setTimeout(() => {
        doc.off('afterTransaction', onTransaction)
        if (retriesLeft > 0) void attempt(retriesLeft - 1)
      }, 2500)
    }
    void attempt(2)

    return () => {
      cancelled = true
      stopWatching()
    }
  }, [blockId, provider, synced, canWrite, liveFor])

  // Leaving or replacing the room ends live mode with it.
  React.useEffect(() => {
    if (liveFor && liveFor !== provider) setLiveFor(null)
  }, [liveFor, provider])

  return { live: liveFor !== null && liveFor === provider, provider }
}
