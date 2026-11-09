import { describe, expect, it } from 'vitest'

import { AnswerCleaner, cleanAnswer } from './assistant-output'

describe('cleanAnswer', () => {
  it('removes a raw tool call the model was never offered', () => {
    const raw =
      "<|tool_call_start|>[sheetbase(workspace='0', query='list all objects')]<|tool_call_end|>"

    expect(cleanAnswer(raw, true).trim()).toBe('')
  })

  it('keeps the words around a tool call', () => {
    expect(
      cleanAnswer(
        'Let me look. <|tool_call_start|>[x()]<|tool_call_end|> Done.',
        true,
      ),
    ).toBe('Let me look.  Done.')
  })

  it('drops an unfinished tool call and everything after it', () => {
    expect(cleanAnswer('Hello <|tool_call_start|>[x(', true)).toBe('Hello ')
  })

  it('strips other chat-template tokens', () => {
    expect(cleanAnswer('Fine.<|im_end|>', true)).toBe('Fine.')
  })

  it('leaves ordinary angle brackets alone', () => {
    expect(cleanAnswer('Use a < b and <b>bold</b>', true)).toBe(
      'Use a < b and <b>bold</b>',
    )
  })
})

describe('AnswerCleaner', () => {
  it('never shows half a token while streaming', () => {
    const cleaner = new AnswerCleaner()

    const shown = [
      'Hi ',
      '<|tool',
      '_call_start|>[x()]',
      '<|tool_call_end|>',
      ' bye',
    ]
      .map((piece) => cleaner.push(piece))
      .join('')

    expect(shown + cleaner.finish()).toBe('Hi  bye')
    expect(cleaner.hasContent).toBe(true)
  })

  it('holds back a lone "<" until it is known to be text', () => {
    const cleaner = new AnswerCleaner()
    expect(cleaner.push('a <')).toBe('a ')
    expect(cleaner.push(' b')).toBe('< b')
  })

  it('reports no content when the whole answer was junk', () => {
    const cleaner = new AnswerCleaner()
    cleaner.push('<|tool_call_start|>[x()]<|tool_call_end|>')
    expect(cleaner.finish()).toBe('')
    expect(cleaner.hasContent).toBe(false)
  })
})
