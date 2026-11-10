import { Editor } from '@tiptap/react'
import Collaboration from '@tiptap/extension-collaboration'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'
import { createElement } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CollabProvider } from '#/lib/collaboration/provider'
import { RoomProviderContext } from '#/lib/collaboration/room-hooks'
import type { RichTextDocument } from '#/lib/blocks/rich-text-data'

import {
  fingerprint,
  fragmentMatches,
  liveFieldName,
  reseedFragment,
  seedFragment,
  useLiveRichText,
} from './live-rich-text'

const saved: RichTextDocument = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Objective' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Titrate ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'slowly' },
      ],
    },
  ],
}

const extensions = [StarterKit.configure({ undoRedo: false })]

function editorOn(doc: Y.Doc, blockId: string) {
  return new Editor({
    extensions: [
      ...extensions,
      Collaboration.configure({ document: doc, field: liveFieldName(blockId) }),
    ],
  })
}

describe('seedFragment', () => {
  it('puts the saved text into the shared document exactly as the editor reads it back', () => {
    const doc = new Y.Doc()
    seedFragment({ doc }, 'b1', extensions, saved)
    const editor = editorOn(doc, 'b1')
    expect(editor.getJSON()).toEqual(saved)
    editor.destroy()
  })

  it('marks the block as seeded and never seeds it twice', () => {
    const doc = new Y.Doc()
    const provider = { doc }
    seedFragment(provider, 'b1', extensions, saved)
    expect(doc.getMap('seeded').has('b1')).toBe(true)
    seedFragment(provider, 'b1', extensions, saved)
    const editor = editorOn(doc, 'b1')
    expect(editor.getJSON()).toEqual(saved)
    editor.destroy()
  })

  it('keeps blocks apart in one room', () => {
    const doc = new Y.Doc()
    const provider = { doc }
    seedFragment(provider, 'b1', extensions, saved)
    expect(doc.getXmlFragment(liveFieldName('b2')).length).toBe(0)
  })

  it('lets two editors on one document see each other type', () => {
    const doc = new Y.Doc()
    seedFragment({ doc }, 'b1', extensions, saved)
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    doc.on('update', (update: Uint8Array) => Y.applyUpdate(peer, update))
    const a = editorOn(doc, 'b1')
    const b = editorOn(peer, 'b1')
    a.commands.insertContentAt(a.state.doc.content.size - 1, ' and carefully')
    expect(JSON.stringify(b.getJSON())).toContain('and carefully')
    a.destroy()
    b.destroy()
  })
})

describe('stale shared text', () => {
  const other: RichTextDocument = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Changed elsewhere' }],
      },
    ],
  }

  it('tells when the shared copy no longer matches what was saved', () => {
    const doc = new Y.Doc()
    seedFragment({ doc }, 'b1', extensions, saved)
    expect(fragmentMatches(doc, 'b1', extensions, saved)).toBe(true)
    expect(fragmentMatches(doc, 'b1', extensions, other)).toBe(false)
  })

  it('starts again from the saved copy', () => {
    const doc = new Y.Doc()
    const provider = { doc }
    seedFragment(provider, 'b1', extensions, saved)
    reseedFragment(provider, 'b1', extensions, other)
    expect(fragmentMatches(doc, 'b1', extensions, other)).toBe(true)
    const editor = editorOn(doc, 'b1')
    expect(editor.getJSON()).toEqual(other)
    editor.destroy()
  })
})

describe('fingerprint', () => {
  it('is the same for the same document and differs when it changes', () => {
    expect(fingerprint(saved)).toBe(fingerprint(structuredClone(saved)))
    expect(fingerprint(saved)).not.toBe(fingerprint({ ...saved, content: [] }))
  })
})

it('clears pending seed retries on provider replacement and unmount', async () => {
  vi.useFakeTimers()
  const webSocket = globalThis.WebSocket
  vi.stubGlobal('WebSocket', undefined)

  // A peer owns the seed claim. Keep the real document, awareness and room
  // subscriptions; only the remote claim response is controlled here.
  class WaitingProvider extends CollabProvider {
    override claimSeed() {
      return Promise.resolve(false)
    }
  }

  const first = new WaitingProvider('ws://localhost/first')
  const second = new WaitingProvider('ws://localhost/second')
  vi.stubGlobal('WebSocket', webSocket)

  for (const provider of [first, second]) {
    provider.synced = true
    provider.canWrite = true
    provider.awareness.setLocalState({ user: { id: 'author' } })
    provider.awareness
      .getStates()
      .set(provider.doc.clientID + 1, { user: { id: 'peer' } })
  }

  const idleTimers = vi.getTimerCount()
  let current: CollabProvider = first

  try {
    const { rerender, unmount } = renderHook(
      () =>
        useLiveRichText({
          blockId: 'b1',
          extensions,
          getSaved: () => saved,
          edited: () => false,
        }),
      {
        wrapper: ({ children }) =>
          createElement(
            RoomProviderContext.Provider,
            { value: current },
            children,
          ),
      },
    )

    await act(async () => {})
    expect(vi.getTimerCount()).toBe(idleTimers + 1)

    current = second
    rerender()
    await act(async () => {})
    expect(vi.getTimerCount()).toBe(idleTimers + 1)

    unmount()
    expect(vi.getTimerCount()).toBe(idleTimers)
  } finally {
    first.destroy()
    second.destroy()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
})
