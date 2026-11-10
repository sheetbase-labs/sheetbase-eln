// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it } from 'vitest'

import {
  createInMemoryStorage,
  createOfflineEditStore,
} from '#/lib/offline/store'
import { richTextPayloadFromText } from '#/lib/offline/replay'
import { OfflineEditsProvider, useOfflineEdits } from './offline-edits'
import { losslessPlainText } from './offline-edit-model'

const scope = { userId: 'u1', recordId: 'r1' }

function setup() {
  const store = createOfflineEditStore(createInMemoryStorage())

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <OfflineEditsProvider store={store} scope={scope}>
      {children}
    </OfflineEditsProvider>
  )

  return { store, ...renderHook(() => useOfflineEdits(), { wrapper }) }
}

describe('losslessPlainText', () => {
  it('keeps plain paragraphs', () => {
    expect(losslessPlainText(richTextPayloadFromText('a\nb'))).toBe('a\nb')
  })
  it('refuses formatting that plain text would lose', () => {
    const bold = {
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }],
          },
        ],
      },
    }

    expect(losslessPlainText(bold)).toBeNull()
  })
})

describe('queueBlockText', () => {
  it('keeps the latest text and the first revision it was based on', async () => {
    const { store, result } = setup()
    await act(async () => {
      await result.current.queueBlockText(
        { id: 'b1', version: 3 },
        richTextPayloadFromText('one'),
      )
    })
    await act(async () => {
      await result.current.queueBlockText(
        { id: 'b1', version: 3 },
        richTextPayloadFromText('two'),
      )
    })
    const edits = await store.listEdits(scope)
    expect(edits).toHaveLength(1)
    expect(edits[0]).toMatchObject({
      kind: 'block_text',
      text: 'two',
      expectedRevision: 3,
    })
  })

  it('declines text it cannot keep without losing formatting', async () => {
    const { store, result } = setup()
    let kept = true
    await act(async () => {
      kept = await result.current.queueBlockText(
        { id: 'b1', version: 1 },
        { doc: { type: 'doc', content: [{ type: 'heading', level: 1 }] } },
      )
    })
    expect(kept).toBe(false)
    expect(await store.listEdits(scope)).toHaveLength(0)
  })
})
