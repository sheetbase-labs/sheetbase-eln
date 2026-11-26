import { afterEach, describe, expect, it } from 'vitest'
import type { AssistantUIMessage } from './assistant-chat'

import { panesLine } from './assistant'
import {
  hydrateCardOutcomes,
  recordCardOutcome,
  resetCardOutcomes,
} from './assistant-card-outcomes'
import { toChatTurns } from './assistant-chat'
import { messagesToSave } from './agent-conversations'

const card: AssistantUIMessage = {
  id: 'a',
  role: 'assistant',
  parts: [
    { type: 'text', text: 'Here is the experiment.' },
    {
      type: 'dynamic-tool',
      toolName: 'sheetbase.planner.plan_experiment',
      toolCallId: 'call-1',
      state: 'output-available',
      input: {},
      output: {
        ok: true,
        proposal: { tool: 't', title: 'PicoGreen experiment', changes: [] },
      },
    },
  ],
}

afterEach(resetCardOutcomes)

describe('card outcomes told to the assistant', () => {
  it('says a card was not applied yet', () => {
    const [turn] = toChatTurns([card])

    expect(turn.content).toContain('shown, not applied yet')
  })

  it('says what an applied card made', () => {
    recordCardOutcome('call-1', {
      status: 'applied',
      title: 'PicoGreen experiment',
      made: { identifier: 'EXP-4302', title: 'PicoGreen' },
      at: 'now',
    })

    const [turn] = toChatTurns([card])

    expect(turn.content).toContain('APPLIED')
    expect(turn.content).toContain('EXP-4302')
  })

  it('saves the outcome with the chat and reads it back', () => {
    recordCardOutcome('call-1', {
      status: 'dismissed',
      title: 'PicoGreen experiment',
      at: 'now',
    })

    const saved = messagesToSave([card])

    resetCardOutcomes()
    hydrateCardOutcomes(saved)

    expect(toChatTurns(saved)[0].content).toContain('dismissed')
  })
})

describe('open panes line', () => {
  it('names each pane and marks the focused one', () => {
    const line = panesLine([
      {
        path: '/experiments/x',
        title: 'Experiment',
        identifier: 'EXP-4302',
        active: true,
      },
    ])

    expect(line).toContain('(focused) Experiment EXP-4302')
  })

  it('is empty without panes', () => {
    expect(panesLine([])).toBeNull()
  })
})
