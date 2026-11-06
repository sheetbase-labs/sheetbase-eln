import { Editor } from '@tiptap/react'
import Collaboration from '@tiptap/extension-collaboration'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'

import type { CollabProvider } from '#/lib/collaboration/provider'
import type { RichTextDocument } from '#/lib/blocks/rich-text'

import {
  fingerprint,
  fragmentMatches,
  liveFieldName,
  reseedFragment,
  seedFragment,
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
    seedFragment({ doc } as CollabProvider, 'b1', extensions, saved)
    const editor = editorOn(doc, 'b1')
    expect(editor.getJSON()).toEqual(saved)
    editor.destroy()
  })

  it('marks the block as seeded and never seeds it twice', () => {
    const doc = new Y.Doc()
    const provider = { doc } as CollabProvider
    seedFragment(provider, 'b1', extensions, saved)
    expect(doc.getMap('seeded').has('b1')).toBe(true)
    seedFragment(provider, 'b1', extensions, saved)
    const editor = editorOn(doc, 'b1')
    expect(editor.getJSON()).toEqual(saved)
    editor.destroy()
  })

  it('keeps blocks apart in one room', () => {
    const doc = new Y.Doc()
    const provider = { doc } as CollabProvider
    seedFragment(provider, 'b1', extensions, saved)
    expect(doc.getXmlFragment(liveFieldName('b2')).length).toBe(0)
  })

  it('lets two editors on one document see each other type', () => {
    const doc = new Y.Doc()
    seedFragment({ doc } as CollabProvider, 'b1', extensions, saved)
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
    seedFragment({ doc } as CollabProvider, 'b1', extensions, saved)
    expect(fragmentMatches(doc, 'b1', extensions, saved)).toBe(true)
    expect(fragmentMatches(doc, 'b1', extensions, other)).toBe(false)
  })

  it('starts again from the saved copy', () => {
    const doc = new Y.Doc()
    const provider = { doc } as CollabProvider
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
    expect(fingerprint(saved)).toBe(
      fingerprint(JSON.parse(JSON.stringify(saved))),
    )
    expect(fingerprint(saved)).not.toBe(fingerprint({ ...saved, content: [] }))
  })
})
