/**
 * The folder agent's live mode: turning an instrument's lines into readings,
 * following a file that is still being written, and sending batches.
 */
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LIVE_BUFFER_LIMIT,
  createLineParser,
  createLiveSender,
  createTail,
  parseArgs,
  splitFeedLabel,
} from './instrument-agent.mjs'

const NOW = Date.parse('2026-11-05T09:30:00Z')

describe('splitFeedLabel', () => {
  it('reads a unit from brackets', () => {
    expect(splitFeedLabel('Chamber temp (°C)')).toEqual({
      feed: 'Chamber temp',
      unit: '°C',
    })
    expect(splitFeedLabel('pH [pH]')).toEqual({ feed: 'pH', unit: 'pH' })
    expect(splitFeedLabel('Weight')).toEqual({ feed: 'Weight', unit: '' })
  })
})

describe('createLineParser', () => {
  it('reads a lone value and its unit, as a balance prints it', () => {
    const parser = createLineParser({ feed: 'Weight' }, () => NOW)
    expect(parser.parse('   12.345 g\r')).toEqual([
      { feed: 'Weight', value: 12.345, unit: 'g' },
    ])
    expect(parser.parse('ST,GS,+  0.5 g')).toEqual([
      { feed: 'Weight', value: 0.5, unit: 'g' },
    ])
    expect(parser.parse('')).toEqual([])
  })

  it('uses the configured unit over the one on the line', () => {
    const parser = createLineParser({ feed: 'Weight', unit: 'mg' })
    expect(parser.parse('1.5 g')[0]).toMatchObject({ unit: 'mg' })
  })

  it('reads a header row, then times and values with their units', () => {
    const parser = createLineParser({}, () => NOW)
    expect(parser.parse('Time,Temperature (°C),Humidity (%)')).toEqual([])
    expect(parser.parse('2026-11-05T09:00:00Z,4.1,61.5')).toEqual([
      {
        feed: 'Temperature',
        value: 4.1,
        unit: '°C',
        at: '2026-11-05T09:00:00.000Z',
      },
      {
        feed: 'Humidity',
        value: 61.5,
        unit: '%',
        at: '2026-11-05T09:00:00.000Z',
      },
    ])
  })

  it('works without a header, and skips what it cannot read', () => {
    const parser = createLineParser({ feed: 'Probe' }, () => NOW)
    expect(parser.parse('2026-11-05T09:00:01Z;21.5;22.5')).toEqual([
      { feed: 'Probe 1', value: 21.5, at: '2026-11-05T09:00:01.000Z' },
      { feed: 'Probe 2', value: 22.5, at: '2026-11-05T09:00:01.000Z' },
    ])
    expect(parser.parse('2026-11-05T09:00:02Z;oops;23')).toEqual([
      { feed: 'Probe 2', value: 23, at: '2026-11-05T09:00:02.000Z' },
    ])
  })
})

describe('createTail', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tail-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns only what is added, and holds back a half-written line', async () => {
    const path = join(dir, 'log.csv')
    await writeFile(path, 'Time,Temp (°C)\n2026-11-05T09:00:00Z,4\n')
    const tail = createTail(path)
    const first = await tail.poll()
    expect(first.lines).toEqual([])
    expect(first.header).toBe('Time,Temp (°C)')
    await appendFile(path, '2026-11-05T09:00:01Z,4.2\n2026-11-05T09:00:02Z,')
    expect((await tail.poll()).lines).toEqual(['2026-11-05T09:00:01Z,4.2'])
    await appendFile(path, '4.3\n')
    expect((await tail.poll()).lines).toEqual(['2026-11-05T09:00:02Z,4.3'])
    expect((await tail.poll()).lines).toEqual([])
  })

  it('starts from the top when asked, and when the file starts over', async () => {
    const path = join(dir, 'log.txt')
    await writeFile(path, '1\n2\n')
    const tail = createTail(path, { fromStart: true })
    expect((await tail.poll()).lines).toEqual(['1', '2'])
    await writeFile(path, '3\n')
    expect((await tail.poll()).lines).toEqual(['3'])
  })

  it('waits for a file that does not exist yet', async () => {
    const tail = createTail(join(dir, 'later.txt'))
    expect(await tail.poll()).toEqual({ lines: [], header: null })
  })
})

describe('createLiveSender', () => {
  const options = { url: 'http://eln.test', instrumentId: 'inst-1' }
  const reading = { feed: 'T', value: 1 }

  function sender(responses: Array<Response | Error>) {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => {
        const next = responses.shift()!

        if (next instanceof Error) throw next

        return next
      },
    )

    const log = vi.fn()

    return {
      fetchImpl,
      log,
      live: createLiveSender(options, {
        ensureToken: async () => 'tok',
        fetchImpl,
        log,
      }),
    }
  }

  it('sends a batch and empties the queue', async () => {
    const { live, fetchImpl } = sender([
      Response.json({ stored: 2, feeds: 1 }, { status: 201 }),
    ])

    live.push([reading, reading])
    expect(await live.flush()).toBe('sent')
    expect(live.pending).toBe(0)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('http://eln.test/api/connectors/stream')
    expect(await new Response(init?.body).json()).toEqual({
      instrumentId: 'inst-1',
      readings: [reading, reading],
    })
  })

  it('keeps readings when the server or network is down, and drops refused ones', async () => {
    const { live } = sender([
      Response.json({ error: { code: 'x', message: 'down' } }, { status: 503 }),
      new Error('offline'),
      Response.json(
        { error: { code: 'refused', message: 'bad' } },
        { status: 422 },
      ),
    ])

    live.push([reading])
    expect(await live.flush()).toBe('retry')
    expect(await live.flush()).toBe('retry')
    expect(live.pending).toBe(1)
    expect(await live.flush()).toBe('dropped')
    expect(live.pending).toBe(0)
  })

  it('stops for good when the token owner may not send', async () => {
    const { live } = sender([
      Response.json(
        { error: { code: 'forbidden', message: 'no' } },
        { status: 403 },
      ),
    ])

    live.push([reading])
    await expect(live.flush()).rejects.toMatchObject({ permanent: true })
  })

  it('bounds what it holds while offline', () => {
    const { live } = sender([])
    live.push(Array.from({ length: LIVE_BUFFER_LIMIT + 10 }, () => reading))
    expect(live.pending).toBe(LIVE_BUFFER_LIMIT)
  })
})

describe('parseArgs for live sources', () => {
  it('needs the instrument, not a folder, when it only follows live sources', () => {
    const options = parseArgs(
      [
        '--live-file',
        'D:\\Logs\\temp.csv',
        '--feed',
        'Chamber',
        '--unit',
        '°C',
      ],
      { SHEETBASE_URL: 'http://eln.test', SHEETBASE_CREDENTIAL: 'sbk_x' },
      { instrumentId: 'inst-1' },
    )

    expect(options.live).toEqual([
      { kind: 'file', path: 'D:\\Logs\\temp.csv', feed: 'Chamber', unit: '°C' },
    ])
    expect(() =>
      parseArgs(
        ['--live-tcp', 'scale:4001'],
        { SHEETBASE_URL: 'http://eln.test', SHEETBASE_CREDENTIAL: 'sbk_x' },
        {},
      ),
    ).toThrow(/instrument/)
  })

  it('takes a network source from the settings file', () => {
    const options = parseArgs(
      [],
      {},
      {
        url: 'http://eln.test',
        credential: 'sbk_x',
        instrumentId: 'inst-1',
        live: [
          { kind: 'network', host: '10.0.0.5', port: 4001, feed: 'Weight' },
        ],
      },
    )

    expect(options.live[0]).toMatchObject({ host: '10.0.0.5', port: 4001 })
    expect(() =>
      parseArgs(
        [],
        {},
        {
          url: 'x',
          credential: 'y',
          instrumentId: 'z',
          live: [{ kind: 'network', host: '' }],
        },
      ),
    ).toThrow(/host and a port/)
  })
})
