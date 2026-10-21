/**
 * INT-02 — the watched-folder pickup agent: what it sends, when, and where files end up.
 */
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  contentTypeFor,
  createAgent,
  parseArgs,
  tokenExpiry,
} from './instrument-agent.mjs'
import type { AgentOptions } from './instrument-agent.mjs'

let dir: string
let clock: number

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-'))
  clock = 1_000_000
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function options(overrides: Partial<AgentOptions> = {}): AgentOptions {
  return {
    url: 'http://eln.test',
    credential: 'sbk_secret',
    connector: 'qpcr-bench',
    dir,
    extensions: ['csv', 'json'],
    settleSeconds: 3,
    intervalSeconds: 5,
    once: false,
    parser: '',
    ...overrides,
  }
}

function jwt(exp: number) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url')
  return `h.${payload}.s`
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

function makeFetch(pickup: Handler) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init: init ?? {} })
      if (url.endsWith('/api/token')) {
        return Response.json({ token: jwt(clock / 1000 + 900) })
      }
      return pickup(url, init ?? {})
    },
  ) as unknown as typeof fetch
  return { impl, calls }
}

function agentWith(pickup: Handler, overrides: Partial<AgentOptions> = {}) {
  const { impl, calls } = makeFetch(pickup)
  const logs: string[] = []
  const agent = createAgent(options(overrides), {
    fetch: impl,
    log: (line) => logs.push(line),
    now: () => clock,
  })
  return { agent, calls, logs }
}

const ok = () =>
  Response.json(
    { rowCount: 2, datasetId: 'ds-1', parser: 'p@1' },
    { status: 201 },
  )

describe('instrument agent', () => {
  it('waits for a file to settle, then sends it and moves it to processed/', async () => {
    await writeFile(join(dir, 'run1.csv'), 'Well,Ct\nA1,20\n')
    const { agent, calls } = agentWith(ok)

    expect(await agent.scan()).toMatchObject({ sent: 0, waiting: 1 })
    clock += 1000
    expect(await agent.scan()).toMatchObject({ sent: 0, waiting: 1 })
    clock += 3000
    expect(await agent.scan()).toMatchObject({ sent: 1 })

    const pickup = calls.find((c) => c.url.includes('/pickup'))!
    expect(pickup.url).toContain('connector=qpcr-bench')
    expect(pickup.url).toContain('fileName=run1.csv')
    const headers = pickup.init.headers as Record<string, string>
    expect(headers.authorization).toMatch(/^Bearer h\./)
    expect(headers['content-type']).toBe('text/csv')
    expect(await readdir(dir)).toEqual(['processed'])
    expect(
      await readFile(join(dir, 'processed', 'run1.csv'), 'utf8'),
    ).toContain('A1,20')
  })

  it('treats a file that is still growing as unsettled', async () => {
    const path = join(dir, 'run2.csv')
    await writeFile(path, 'Well,Ct\n')
    const { agent } = agentWith(ok)
    await agent.scan()
    clock += 5000
    await writeFile(path, 'Well,Ct\nA1,20\n')
    await utimes(path, new Date(), new Date(Date.now() + 60_000))
    expect(await agent.scan()).toMatchObject({ sent: 0, waiting: 1 })
  })

  it('ignores other extensions, hidden files, empty files and folders', async () => {
    await writeFile(join(dir, 'notes.docx'), 'x')
    await writeFile(join(dir, '.hidden.csv'), 'x')
    await writeFile(join(dir, 'empty.csv'), '')
    const { agent, calls } = agentWith(ok)
    await agent.scan()
    clock += 10_000
    await agent.scan()
    expect(calls.filter((c) => c.url.includes('/pickup'))).toHaveLength(0)
  })

  it('moves permanently refused files to failed/ with the reason', async () => {
    await writeFile(join(dir, 'bad.csv'), 'a,b\n1,2\n')
    const { agent, logs } = agentWith(() =>
      Response.json(
        { error: { code: 'parse_failed', message: 'No data rows' } },
        { status: 422 },
      ),
    )
    await agent.scan()
    clock += 5000
    expect(await agent.scan()).toMatchObject({ failed: 1 })
    expect(await readdir(join(dir, 'failed'))).toEqual([
      'bad.csv',
      'bad.csv.error.txt',
    ])
    expect(
      await readFile(join(dir, 'failed', 'bad.csv.error.txt'), 'utf8'),
    ).toBe('parse_failed: No data rows\n')
    expect(logs.join('\n')).toMatch(/refused bad.csv/)
  })

  it('keeps files in place and backs off on server errors', async () => {
    await writeFile(join(dir, 'later.csv'), 'a,b\n1,2\n')
    let status = 503
    const { agent, calls } = agentWith(() =>
      status === 503
        ? Response.json({ error: { code: 'x', message: 'down' } }, { status })
        : ok(),
    )
    await agent.scan()
    clock += 5000
    expect(await agent.scan()).toMatchObject({ retry: 1 })
    expect(await readdir(dir)).toEqual(['later.csv'])

    // Still inside the back-off window: no new request.
    const before = calls.length
    clock += 1000
    expect(await agent.scan()).toMatchObject({ waiting: 1 })
    expect(calls.length).toBe(before)

    status = 201
    clock += 10_000
    expect(await agent.scan()).toMatchObject({ sent: 1 })
  })

  it('retries conflicts such as a stale Dataset revision', async () => {
    await writeFile(join(dir, 'c.csv'), 'a\n1\n')
    const { agent } = agentWith(() =>
      Response.json(
        { error: { code: 'stale', message: 'stale' } },
        { status: 409 },
      ),
    )
    await agent.scan()
    clock += 5000
    expect(await agent.scan()).toMatchObject({ retry: 1 })
    expect(await readdir(dir)).toEqual(['c.csv'])
  })

  it('re-exchanges the credential once when the token is rejected', async () => {
    await writeFile(join(dir, 'd.csv'), 'a\n1\n')
    let first = true
    const { agent, calls } = agentWith(() => {
      if (first) {
        first = false
        return Response.json({ error: { code: 'revoked' } }, { status: 401 })
      }
      return ok()
    })
    await agent.scan()
    clock += 5000
    expect(await agent.scan()).toMatchObject({ sent: 1 })
    expect(calls.filter((c) => c.url.endsWith('/api/token'))).toHaveLength(2)
  })

  it('never sends the credential to the pickup endpoint', async () => {
    await writeFile(join(dir, 'e.csv'), 'a\n1\n')
    const { agent, calls } = agentWith(ok)
    await agent.scan()
    clock += 5000
    await agent.scan()
    const pickup = calls.find((c) => c.url.includes('/pickup'))!
    expect(JSON.stringify(pickup)).not.toContain('sbk_secret')
  })

  it('stops with a permanent error when the credential is refused', async () => {
    await writeFile(join(dir, 'f.csv'), 'a\n1\n')
    const fetchImpl = (async () =>
      Response.json(
        { error: { message: 'bad' } },
        { status: 403 },
      )) as unknown as typeof fetch
    const agent = createAgent(options(), {
      fetch: fetchImpl,
      log: () => {},
      now: () => clock,
    })
    await agent.scan()
    clock += 5000
    await expect(agent.scan()).rejects.toMatchObject({ permanent: true })
  })

  it('does not overwrite an earlier processed file of the same name', async () => {
    const { agent } = agentWith(ok)
    for (let i = 0; i < 2; i += 1) {
      await writeFile(join(dir, 'same.csv'), `a\n${i}\n`)
      await agent.scan()
      clock += 5000
      await agent.scan()
      clock += 5000
    }
    expect(await readdir(join(dir, 'processed'))).toHaveLength(2)
  })
})

describe('instrument agent helpers', () => {
  it('reads options from flags over the environment and requires the essentials', () => {
    const parsed = parseArgs(
      [
        '--connector',
        'c',
        '--dir',
        '/d',
        '--extensions',
        '.CSV, tsv',
        '--once',
      ],
      { SHEETBASE_URL: 'https://eln.test/', SHEETBASE_CREDENTIAL: 'k' },
    )
    expect(parsed).toMatchObject({
      url: 'https://eln.test',
      extensions: ['csv', 'tsv'],
      once: true,
    })
    expect(() => parseArgs([], {})).toThrow(/required/)
    expect(() => parseArgs(['--nope'], {})).toThrow(/Unknown option/)
  })

  it('reads token expiry and content types', () => {
    expect(tokenExpiry(jwt(123))).toBe(123)
    expect(tokenExpiry('garbage')).toBe(0)
    expect(contentTypeFor('A.JSON')).toBe('application/json')
    expect(contentTypeFor('a.bin')).toBe('application/octet-stream')
  })
})
