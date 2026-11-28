import { describe, expect, it } from 'vitest'

import {
  groupConversations,
  groupOf,
  messagesToSave,
  titleFromMessages,
} from './agent-conversations'
import type { AssistantUIMessage } from './assistant-chat'

const now = new Date(2026, 10, 15, 14, 0, 0)

const say = (
  role: 'user' | 'assistant',
  text: string,
  id = `${role}-${text}`,
): AssistantUIMessage => ({ id, role, parts: [{ type: 'text', text }] })

const row = (id: string, daysAgo: number) => ({
  id,
  title: id,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: new Date(2026, 10, 15 - daysAgo, 9, 0, 0).toISOString(),
})

describe('conversation groups', () => {
  it('puts a chat in the group its last change falls in', () => {
    expect(groupOf(row('a', 0).updated_at, now)).toBe('today')
    expect(groupOf(row('a', 1).updated_at, now)).toBe('yesterday')
    expect(groupOf(row('a', 4).updated_at, now)).toBe('week')
    expect(groupOf(row('a', 30).updated_at, now)).toBe('earlier')
  })

  it('keeps the order within a group and drops empty groups', () => {
    const groups = groupConversations(
      [row('x', 0), row('y', 0), row('z', 40)],
      now,
    )

    expect(groups.map((g) => g.group)).toEqual(['today', 'earlier'])
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(['x', 'y'])
  })
})

describe('conversation title', () => {
  it('is the first question, kept short', () => {
    expect(
      titleFromMessages([say('user', '  Which   reagents\nare low? ')]),
    ).toBe('Which reagents are low?')

    const long = titleFromMessages([say('user', 'a'.repeat(200))])

    expect(long?.length).toBe(48)
    expect(long?.endsWith('…')).toBe(true)
  })

  it('drops greetings and lead-ins so chats that start alike read apart', () => {
    expect(
      titleFromMessages([
        say(
          'user',
          "I'd like you to setup a PicoGreen dsDNA assay for the AAV9 harvest samples. Use the plate reader.",
        ),
      ]),
    ).toBe('Set up a PicoGreen dsDNA assay for the AAV9…')
    expect(
      titleFromMessages([
        say('user', 'Hi, could you please make a notebook template for p24'),
      ]),
    ).toBe('Make a notebook template for p24')
    expect(
      titleFromMessages([
        say(
          'user',
          'What is stopping EXP-0142 from being submitted for review?',
        ),
      ]),
    ).toBe('What is stopping EXP-0142 from being submitted…')
  })

  it('keeps the words when the whole message is a greeting', () => {
    expect(titleFromMessages([say('user', 'Hello')])).toBe('Hello')
  })

  it('is nothing until there is a question', () => {
    expect(titleFromMessages([])).toBeUndefined()
  })
})

describe('what is saved', () => {
  it('leaves out an answer that came back empty', () => {
    const kept = messagesToSave([
      say('user', 'Hello'),
      say('assistant', '   ', 'empty'),
    ])

    expect(kept.map((m) => m.id)).toEqual(['user-Hello'])
  })
})
