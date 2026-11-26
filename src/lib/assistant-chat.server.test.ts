import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { plainProposal } from './assistant-proposals'
import type { AssistantProposal } from './assistant-proposals'

describe('card wording', () => {
  it('cleans every card the chat sends, whichever tool built it', () => {
    const card = {
      tool: 'sheetbase.booking.create',
      title: 'Set requireChangeReason',
      summary: 'Then p_lock_on_sign and audit_retention_days stay',
      target: 'x',
      deepLink: null,
      changes: [],
    } satisfies AssistantProposal

    expect(plainProposal(card)).toMatchObject({
      title: 'Set require change reason',
      summary: 'Then lock on sign and audit retention days stay',
    })
  })

  it('has no way to send a card to the browser without cleaning it', () => {
    const source = readFileSync('src/lib/assistant-chat.server.ts', 'utf8')

    expect(source).toContain('plainProposal(event.proposal)')
    expect(source.match(/event\.proposal/g)).toHaveLength(2)
  })
})
