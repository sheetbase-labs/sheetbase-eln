import { describe, expect, it } from 'vitest'

import type { UndoPreview } from './undo'
import { blockedWords, isUndoableTool } from './undo'

const preview = (items: UndoPreview['items']): UndoPreview => ({
  setId: '00000000-0000-4000-8000-000000000001',
  title: 'A plan',
  kind: 'plan',
  status: 'applied',
  canUndo: false,
  items,
  blocked: items.filter((item) => item.state === 'blocked').length,
  toUndo: 0,
})

describe('undo', () => {
  it('knows which card tools the audit trail carries in full', () => {
    expect(isUndoableTool('sheetbase.booking.create')).toBe(true)
    expect(isUndoableTool('sheetbase.signature.sign')).toBe(false)
  })

  it('says each refusal with its reason', () => {
    const words = blockedWords(
      preview([
        {
          key: 'a',
          kind: 'record',
          action: 'archive',
          verb: 'Archive',
          label: 'S-1 Sample',
          state: 'blocked',
          reason: 'Signed.',
        },
        {
          key: 'b',
          kind: 'booking',
          action: 'cancel_booking',
          verb: 'Cancel',
          label: 'A booking',
          state: 'ok',
        },
        {
          key: 'c',
          kind: 'other',
          action: 'none',
          verb: '',
          label: 'A comment',
          state: 'blocked',
        },
      ]),
    )

    expect(words).toEqual(['S-1 Sample: Signed.', 'A comment.'])
  })
})
