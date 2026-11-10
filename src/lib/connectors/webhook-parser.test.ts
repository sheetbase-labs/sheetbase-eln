import { describe, expect, it, vi } from 'vitest'

import {
  WebhookParserError,
  readWebhookParserAnswer,
  readWebhookParserError,
  webhookMediaType,
  webhookTarget,
} from './webhook-parser'
import { callWebhookParser, signParserRequest } from './webhook-parser.server'

describe('reading a parser service’s answer', () => {
  it('turns every cell into text and keeps blanks blank', () => {
    const parsed = readWebhookParserAnswer({
      headers: ['Sample', 'OD', 'Flag'],
      rows: [
        { Sample: 'A1', OD: 0.42, Flag: true },
        { Sample: 'A2', OD: null },
      ],
      metadata: { instrument: 'PL-8', run: 7 },
      warnings: ['one row was short'],
    })

    expect(parsed.rows).toEqual([
      { Sample: 'A1', OD: '0.42', Flag: 'true' },
      { Sample: 'A2', OD: '', Flag: '' },
    ])
    expect(parsed.metadata).toEqual({ instrument: 'PL-8', run: '7' })
    expect(parsed.warnings).toEqual(['one row was short'])
  })

  it('preserves own scientific keys and validates their original values', () => {
    const parsed = readWebhookParserAnswer(
      JSON.parse(
        '{"rows":[{"__proto__":5.75,"sample":"A1"}],"metadata":{"__proto__":true}}',
      ),
    )

    expect(parsed.headers).toEqual(['__proto__', 'sample'])
    expect(Object.hasOwn(parsed.rows[0], '__proto__')).toBe(true)
    expect(parsed.rows[0]['__proto__']).toBe('5.75')
    expect(Object.hasOwn(parsed.metadata, '__proto__')).toBe(true)
    expect(parsed.metadata['__proto__']).toBe('true')
    expect(Object.getPrototypeOf(parsed.rows[0])).toBe(Object.prototype)
    expect(() =>
      readWebhookParserAnswer(
        JSON.parse('{"rows":[{"__proto__":{"nested":true}}]}'),
      ),
    ).toThrow(/expected shape/)
    expect(() =>
      readWebhookParserAnswer(
        JSON.parse('{"headers":["sample"],"rows":[{"__proto__":4}]}'),
      ),
    ).toThrow(/isn’t in the answer’s headers/)
  })

  it('takes the columns from the rows when no headers are sent', () => {
    const parsed = readWebhookParserAnswer({
      rows: [{ a: 1 }, { a: 2, b: 3 }],
    })

    expect(parsed.headers).toEqual(['a', 'b'])
    expect(parsed.rows[0]).toEqual({ a: '1', b: '' })
  })

  it('refuses a row with a column the headers don’t list', () => {
    expect(() =>
      readWebhookParserAnswer({ headers: ['a'], rows: [{ a: 1, b: 2 }] }),
    ).toThrow(/isn’t in the answer’s headers/)
  })

  it('refuses an answer that isn’t rows', () => {
    expect(() => readWebhookParserAnswer({ rows: 'nope' })).toThrow(
      WebhookParserError,
    )
    expect(() => readWebhookParserAnswer(null)).toThrow(WebhookParserError)
    expect(() =>
      readWebhookParserAnswer({ rows: [{ a: { nested: true } }] }),
    ).toThrow(/expected shape/)
  })

  it('reads the message a service gives for a file it won’t read', () => {
    const error = readWebhookParserError(422, {
      error: { code: 'bad_header', message: 'No Sample column.' },
    })

    expect(error).toMatchObject({
      code: 'webhook_refused',
      message: 'No Sample column.',
    })
    expect(readWebhookParserError(500, 'oops').message).toMatch(/status 500/)

    for (const body of [
      null,
      { error: null },
      { error: { message: 42 } },
      { error: { message: '   ' } },
    ]) {
      expect(readWebhookParserError(503, body)).toMatchObject({
        code: 'webhook_error',
        message: 'The parser service answered with status 503.',
      })
    }

    expect(
      readWebhookParserError(422, {
        error: { message: `  ${'x'.repeat(600)}  ` },
      }).message,
    ).toBe('x'.repeat(500))
  })

  it('finds a webhook address and picks a media type', () => {
    expect(webhookTarget({ webhook: { url: 'https://x.test/p' } })).toEqual({
      url: 'https://x.test/p',
    })
    expect(webhookTarget({ engine: 'a@1' })).toBeNull()

    for (const webhook of [null, [], { url: '' }, { url: 42 }]) {
      expect(webhookTarget({ webhook })).toBeNull()
    }

    expect(webhookMediaType('Run 1.CSV')).toBe('text/csv')
    expect(webhookMediaType('x.bin')).toBe('application/octet-stream')
  })
})

describe('calling a webhook parser', () => {
  const call = {
    url: 'https://parsers.example.org/pl-8',
    secret: 'k',
    parserKey: 'pl-8',
    version: 2,
    fileName: 'run 1.csv',
    mediaType: 'text/csv',
    bytes: new TextEncoder().encode('hello'),
  }

  it('signs the timestamp and the file with the parser’s key', () => {
    // The same value is pinned in sdks/python/tests/test_parsers.py.
    expect(
      signParserRequest('k', '1700000000', new TextEncoder().encode('hello')),
    ).toBe(
      'sha256=0c511384dbc4c6b6cbe53e5da961410697e51518b6128a9f4b1c0920a2ba5ff5',
    )
  })

  it('sends the file with its name, parser and signature and reads the rows', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ rows: [{ a: 1 }] }), {
          headers: { 'content-type': 'application/json' },
        }),
    )

    const parsed = await callWebhookParser(call, {
      fetch: fetchMock,
      now: () => 1700000000,
    })

    expect(parsed.rows).toEqual([{ a: '1' }])

    const [url, init] = fetchMock.mock.calls[0]
    const request = new Request(url, init)

    expect(request.url).toBe('https://parsers.example.org/pl-8')
    expect(request.method).toBe('POST')
    expect(request.redirect).toBe('error')
    expect(Object.fromEntries(request.headers)).toMatchObject({
      'content-type': 'text/csv',
      'x-sheetbase-file-name': 'run%201.csv',
      'x-sheetbase-parser': 'pl-8@2',
      'x-sheetbase-timestamp': '1700000000',
      'x-sheetbase-signature':
        'sha256=0c511384dbc4c6b6cbe53e5da961410697e51518b6128a9f4b1c0920a2ba5ff5',
    })
  })

  it('passes on the words of a refusal', async () => {
    const fetchMock = async () =>
      new Response(
        JSON.stringify({ error: { code: 'x', message: 'Not a PL-8 log.' } }),
        { status: 422 },
      )

    await expect(
      callWebhookParser(call, { fetch: fetchMock }),
    ).rejects.toMatchObject({
      code: 'webhook_refused',
      message: 'Not a PL-8 log.',
    })
  })

  it('says when the service is down or too slow', async () => {
    await expect(
      callWebhookParser(call, {
        fetch: async () => {
          throw new TypeError('fetch failed')
        },
      }),
    ).rejects.toMatchObject({ code: 'webhook_unreachable' })
    await expect(
      callWebhookParser(call, {
        fetch: async () => {
          throw new DOMException('timed out', 'TimeoutError')
        },
      }),
    ).rejects.toMatchObject({ code: 'webhook_timeout' })
  })

  it('refuses an address the site doesn’t allow, and an answer that isn’t JSON', async () => {
    await expect(
      callWebhookParser({ ...call, url: 'ftp://x.test/p' }),
    ).rejects.toMatchObject({ code: 'webhook_address_refused' })
    await expect(
      callWebhookParser(call, {
        fetch: async () => new Response('<html>'),
      }),
    ).rejects.toMatchObject({ code: 'webhook_bad_answer' })
  })
})
