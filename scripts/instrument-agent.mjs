#!/usr/bin/env node
/**
 * INT-02 — watched-folder agent for the computer attached to an instrument.
 *
 * Watches a results folder and sends each finished file to the ELN's
 * `POST /api/connectors/pickup` endpoint, which retains the raw file, parses it
 * and commits it to a Dataset (see src/lib/connectors/pickup.server.ts).
 *
 * The download from an instrument's page already carries its settings in
 * `sheetbase-agent.json` beside this file, so running it is just
 *
 *   node instrument-agent.mjs
 *
 * Everything in that file can also come from the environment or flags:
 *
 *   SHEETBASE_URL=https://eln.example.com \
 *   SHEETBASE_CREDENTIAL=sbk_... \
 *   node scripts/instrument-agent.mjs --connector qpcr-bench --dir D:\Results
 *
 * Plain Node (>= 22), no dependencies, so it can be copied to a lab PC as one
 * file. The credential is a personal API token with `files:write` and
 * `datasets:write`; it is exchanged for a short-lived token and never sent to
 * the pickup endpoint itself.
 *
 * Live readings: an instrument that reports as it runs (a balance, a pH meter,
 * a freezer probe) can be followed too. The agent tails a log file the
 * instrument's software keeps writing, or reads lines from a network port, turns
 * each line into readings and sends them to `POST /api/connectors/stream`, where
 * the instrument's page shows them live.
 *
 *   node instrument-agent.mjs --instrument <id> --live-file D:\\Logs\\temp.csv
 *   node instrument-agent.mjs --instrument <id> --live-tcp 192.168.1.20:4001 --feed Weight --unit g
 *
 * A file is sent once its size and modified time have stopped changing, so a
 * file the instrument is still writing is left alone. Sent files move to
 * `processed/`; files the server refuses for good (bad format, no mapping)
 * move to `failed/` with a `.error.txt` beside them; anything that might work
 * later (network down, server error, rate limit, stale Dataset revision) stays
 * where it is and is retried.
 */
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import { connect } from 'node:net'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const SCOPES = ['files:write', 'datasets:write']
export const DEFAULT_EXTENSIONS = ['csv', 'tsv', 'txt', 'json', 'xlsx']
const RETRYABLE = new Set([408, 409, 425, 429])

export const CONFIG_FILE_NAME = 'sheetbase-agent.json'

/**
 * Settings, lowest to highest priority: the settings file, the environment,
 * then flags. `fileConfig` is the parsed `sheetbase-agent.json`.
 */
export function parseArgs(argv, env = process.env, fileConfig = {}) {
  const text = (value) => (typeof value === 'string' ? value : '')
  const options = {
    url: env.SHEETBASE_URL ?? text(fileConfig.url),
    credential: env.SHEETBASE_CREDENTIAL ?? text(fileConfig.credential),
    connector: env.SHEETBASE_CONNECTOR ?? text(fileConfig.connector),
    dir: env.SHEETBASE_WATCH_DIR ?? text(fileConfig.dir),
    extensions: Array.isArray(fileConfig.extensions)
      ? fileConfig.extensions
      : DEFAULT_EXTENSIONS,
    settleSeconds: 3,
    intervalSeconds: 5,
    once: false,
    parser: text(fileConfig.parser),
    instrumentId: env.SHEETBASE_INSTRUMENT ?? text(fileConfig.instrumentId),
    live: Array.isArray(fileConfig.live)
      ? fileConfig.live.filter((source) => source && typeof source === 'object')
      : [],
  }
  const adHoc = { feed: '', unit: '' }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const next = () => {
      const value = argv[(i += 1)]
      if (value === undefined) throw new Error(`${flag} needs a value.`)
      return value
    }
    if (flag === '--url') options.url = next()
    else if (flag === '--connector') options.connector = next()
    else if (flag === '--dir') options.dir = next()
    else if (flag === '--parser') options.parser = next()
    else if (flag === '--extensions') {
      options.extensions = next()
        .split(',')
        .map((ext) => ext.trim().replace(/^\./, '').toLowerCase())
        .filter(Boolean)
    } else if (flag === '--settle') options.settleSeconds = Number(next())
    else if (flag === '--interval') options.intervalSeconds = Number(next())
    else if (flag === '--once') options.once = true
    else if (flag === '--instrument') options.instrumentId = next()
    else if (flag === '--live-file')
      options.live.push({ kind: 'file', path: next() })
    else if (flag === '--live-tcp') {
      const [host, port] = next().split(':')
      options.live.push({ kind: 'network', host, port: Number(port) })
    } else if (flag === '--feed') adHoc.feed = next()
    else if (flag === '--unit') adHoc.unit = next()
    else if (flag === '--config')
      next() // read before parsing, see main()
    else throw new Error(`Unknown option ${flag}.`)
  }
  for (const source of options.live) {
    if (adHoc.feed && !source.feed) source.feed = adHoc.feed
    if (adHoc.unit && !source.unit) source.unit = adHoc.unit
  }
  const live = options.live.length > 0
  for (const [name, value] of [
    ['the Sheetbase address (url)', options.url],
    ['the access token (credential)', options.credential],
    ...(live
      ? [['the instrument (instrumentId)', options.instrumentId]]
      : [
          ['the instrument (connector)', options.connector],
          ['the results folder (dir)', options.dir],
        ]),
  ]) {
    if (!value) {
      throw new Error(
        `Missing ${name}. Download the agent again from the instrument's page in Sheetbase, or set it in ${CONFIG_FILE_NAME}.`,
      )
    }
  }
  for (const source of options.live) {
    if (source.kind === 'file' && !source.path) {
      throw new Error('A live file needs a path.')
    }
    if (
      source.kind === 'network' &&
      (!source.host || !Number.isInteger(source.port) || source.port < 1)
    ) {
      throw new Error('A live network source needs a host and a port.')
    }
    if (source.kind !== 'file' && source.kind !== 'network') {
      throw new Error('A live source is a file or a network port.')
    }
  }
  options.url = options.url.replace(/\/+$/, '')
  return options
}

/** exp (seconds) from an unverified JWT, or 0 when unreadable. */
export function tokenExpiry(token) {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    )
    return typeof payload.exp === 'number' ? payload.exp : 0
  } catch {
    return 0
  }
}

export function contentTypeFor(fileName) {
  switch (extname(fileName).toLowerCase()) {
    case '.csv':
      return 'text/csv'
    case '.tsv':
      return 'text/tab-separated-values'
    case '.json':
      return 'application/json'
    case '.txt':
      return 'text/plain'
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    default:
      return 'application/octet-stream'
  }
}

async function uniqueTarget(dir, name) {
  await mkdir(dir, { recursive: true })
  let target = join(dir, name)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  try {
    await stat(target)
    target = join(dir, `${stamp}-${name}`)
  } catch {
    // no clash
  }
  return target
}

/**
 * Builds the agent. `fetchImpl` and `log` are injectable for tests; `now`
 * lets tests control the settle clock.
 */
export function createAgent(options, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch
  const log = deps.log ?? ((line) => console.log(line))
  const now = deps.now ?? (() => Date.now())
  const seen = new Map() // path -> { size, mtimeMs, since }
  const backoff = new Map() // path -> { until, attempts }
  let token = ''
  let tokenExp = 0

  async function ensureToken(force = false) {
    if (!force && token && tokenExp - 60 > now() / 1000) return token
    const response = await fetchImpl(`${options.url}/api/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: options.credential, scopes: SCOPES }),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body?.token) {
      const message = body?.error?.message ?? `HTTP ${response.status}`
      const error = new Error(`Credential exchange failed: ${message}`)
      error.permanent = response.status === 400 || response.status === 403
      throw error
    }
    token = body.token
    tokenExp = tokenExpiry(token) || now() / 1000 + 600
    return token
  }

  async function send(path) {
    const name = basename(path)
    const bytes = await readFile(path)
    const query = new URLSearchParams({
      connector: options.connector,
      fileName: name,
    })
    if (options.parser) query.set('parser', options.parser)
    const url = `${options.url}/api/connectors/pickup?${query}`
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await ensureToken(attempt > 0)}`,
          'content-type': contentTypeFor(name),
        },
        body: bytes,
      })
      if (response.status === 401 && attempt === 0) continue
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      }
    }
    throw new Error('Unreachable')
  }

  async function settle(path, info) {
    const previous = seen.get(path)
    if (
      previous &&
      previous.size === info.size &&
      previous.mtimeMs === info.mtimeMs
    ) {
      return now() - previous.since >= options.settleSeconds * 1000
    }
    seen.set(path, { size: info.size, mtimeMs: info.mtimeMs, since: now() })
    return options.settleSeconds === 0
  }

  async function handle(path) {
    const name = basename(path)
    let outcome
    try {
      outcome = await send(path)
    } catch (error) {
      if (error.permanent) throw error
      return retryLater(path, `${name}: ${error.message}`)
    }
    const { status, body } = outcome
    if (status >= 200 && status < 300) {
      const target = await uniqueTarget(join(options.dir, 'processed'), name)
      await rename(path, target)
      log(
        `sent ${name}: ${body?.rowCount ?? '?'} rows → dataset ${body?.datasetId ?? '?'} (${body?.parser ?? 'parser n/a'})`,
      )
      return 'sent'
    }
    const detail = body?.error
      ? `${body.error.code}: ${body.error.message}`
      : `HTTP ${status}`
    if (status >= 500 || RETRYABLE.has(status)) {
      return retryLater(path, `${name}: ${detail}`)
    }
    const target = await uniqueTarget(join(options.dir, 'failed'), name)
    await rename(path, target)
    await writeFile(`${target}.error.txt`, `${detail}\n`)
    log(`refused ${name}: ${detail} (moved to failed/)`)
    return 'failed'
  }

  function retryLater(path, message) {
    const state = backoff.get(path) ?? { attempts: 0, until: 0 }
    state.attempts += 1
    const delay = Math.min(300, 5 * 2 ** (state.attempts - 1))
    state.until = now() + delay * 1000
    backoff.set(path, state)
    log(`will retry ${message} (in ${delay}s)`)
    return 'retry'
  }

  /** One pass over the folder. Returns counts for logging and tests. */
  async function scan() {
    const counts = { sent: 0, failed: 0, retry: 0, waiting: 0 }
    const entries = await readdir(options.dir, { withFileTypes: true })
    const live = new Set()
    for (const entry of entries) {
      // Excel keeps a `~$name.xlsx` lock file beside a workbook that is open.
      if (!entry.isFile() || /^(\.|~\$)/.test(entry.name)) continue
      const ext = extname(entry.name).slice(1).toLowerCase()
      if (!options.extensions.includes(ext)) continue
      const path = join(options.dir, entry.name)
      live.add(path)
      const info = await stat(path)
      if (info.size === 0) {
        counts.waiting += 1
        continue
      }
      if (!(await settle(path, info))) {
        counts.waiting += 1
        continue
      }
      const wait = backoff.get(path)
      if (wait && wait.until > now()) {
        counts.waiting += 1
        continue
      }
      const result = await handle(path)
      counts[result] += 1
      if (result !== 'retry') {
        seen.delete(path)
        backoff.delete(path)
      }
    }
    for (const path of seen.keys()) if (!live.has(path)) seen.delete(path)
    return counts
  }

  return { scan, ensureToken }
}

/** "Temperature (°C)" or "Weight [g]" → the name and its unit. */
export function splitFeedLabel(label) {
  const match = /^(.*?)\s*[([]\s*([^)\]]{1,20}?)\s*[)\]]\s*$/.exec(label.trim())
  return match && match[1]
    ? { feed: match[1].trim(), unit: match[2].trim() }
    : { feed: label.trim(), unit: '' }
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const TIME_LABEL = /^(date|time|timestamp|date.?time)\b/i

function readTime(token, nowMs) {
  if (!token || NUMBER.test(token)) return undefined
  const parsed = Date.parse(token)
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(token)
  if (clock) {
    const at = new Date(nowMs)
    at.setHours(Number(clock[1]), Number(clock[2]), Number(clock[3] ?? 0), 0)
    return at.toISOString()
  }
  return undefined
}

/**
 * Turns the lines an instrument writes into readings. It copes with a lone
 * value ("12.345 g", as a balance prints), and with delimited lines, with or
 * without a header row, with or without a time column ("Time, Temp (°C)").
 * Lines it can't make sense of are skipped rather than stopping the feed.
 */
export function createLineParser(
  { feed = '', unit = '' } = {},
  now = () => Date.now(),
) {
  let header = null
  return {
    parse(line) {
      const text = line.replace(/\r$/, '').trim()
      if (!text) return []
      const single =
        /^(?:[A-Za-z]{1,3}[,\s]+)*([+-]?\s*(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([^\d\s,;\t][^\s,;\t]{0,19})?$/.exec(
          text,
        )
      if (single && !/[,;\t]/.test(text.replace(/^(?:[A-Za-z]{1,3},)+/, ''))) {
        const value = Number(single[1].replace(/\s/g, ''))
        if (!Number.isFinite(value)) return []
        const reading = { feed: feed || 'Reading', value }
        const readUnit = unit || single[2] || ''
        if (readUnit) reading.unit = readUnit
        return [reading]
      }
      const delimiter = text.includes('\t')
        ? '\t'
        : text.includes(';')
          ? ';'
          : text.includes(',')
            ? ','
            : /\s+/
      const tokens = text
        .split(delimiter)
        .map((token) => token.trim().replace(/^"|"$/g, ''))
      const numeric = tokens.filter((token) => NUMBER.test(token)).length
      if (!header) {
        if (numeric === 0 || tokens.every((token) => !NUMBER.test(token))) {
          header = tokens
          return []
        }
        const timeFirst = readTime(tokens[0], now()) !== undefined
        header = tokens.map((_, index) =>
          timeFirst && index === 0
            ? 'Time'
            : tokens.length - (timeFirst ? 1 : 0) === 1
              ? feed || 'Reading'
              : `${feed || 'Channel'} ${index + (timeFirst ? 0 : 1)}`,
        )
      }
      const readings = []
      let at
      header.forEach((label, index) => {
        if (TIME_LABEL.test(label)) at = at ?? readTime(tokens[index], now())
      })
      header.forEach((label, index) => {
        const token = tokens[index]
        if (
          token === undefined ||
          TIME_LABEL.test(label) ||
          !NUMBER.test(token)
        )
          return
        const split = splitFeedLabel(label)
        const reading = {
          feed: split.feed || feed || 'Reading',
          value: Number(token),
        }
        const readUnit = split.unit || unit
        if (readUnit) reading.unit = readUnit
        if (at) reading.at = at
        readings.push(reading)
      })
      return readings
    },
  }
}

/**
 * Follows a file that is still being written. `poll()` returns the whole lines
 * added since the last poll; a half-written last line waits for the next one.
 * A file that shrinks (the instrument started a new log) is read from its top.
 * Starting up, it reads from the end unless `fromStart`, but always returns the
 * first line separately as `header` so a column header is not missed.
 */
export function createTail(path, { fromStart = false } = {}) {
  let offset = null
  let rest = ''
  async function readRange(handle, start, end) {
    const buffer = Buffer.alloc(end - start)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
    return buffer.subarray(0, bytesRead).toString('utf8')
  }
  return {
    async poll() {
      let handle
      try {
        handle = await open(path, 'r')
      } catch (error) {
        if (error.code === 'ENOENT') return { lines: [], header: null }
        throw error
      }
      try {
        const { size } = await handle.stat()
        let header = null
        if (offset === null) {
          if (!fromStart && size > 0) {
            const top = await readRange(handle, 0, Math.min(size, 4096))
            header = top.split('\n')[0] || null
          }
          offset = fromStart ? 0 : size
        }
        if (size < offset) {
          offset = 0
          rest = ''
        }
        if (size === offset) return { lines: [], header }
        const chunk = await readRange(
          handle,
          offset,
          Math.min(size, offset + 1024 * 1024),
        )
        offset += Buffer.byteLength(chunk, 'utf8')
        const parts = (rest + chunk).split('\n')
        rest = parts.pop() ?? ''
        return { lines: parts, header }
      } finally {
        await handle.close()
      }
    },
  }
}

const LIVE_RETRYABLE = new Set([401, 408, 409, 425, 429])
export const LIVE_BUFFER_LIMIT = 5000

/**
 * Batches readings and sends them. What the server refuses outright (bad
 * data) is dropped with a note; what might work later (network down, server
 * error, rate limit) stays queued, oldest dropped past a bound.
 */
export function createLiveSender(
  options,
  { ensureToken, fetchImpl = fetch, log },
) {
  let queue = []
  async function flush() {
    if (queue.length === 0) return 'idle'
    const batch = queue.slice(0, 2000)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response
      try {
        response = await fetchImpl(`${options.url}/api/connectors/stream`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await ensureToken(attempt > 0)}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            instrumentId: options.instrumentId,
            readings: batch,
          }),
        })
      } catch (error) {
        if (error.permanent) throw error
        log(`will retry readings: ${error.message}`)
        return 'retry'
      }
      if (response.status === 401 && attempt === 0) continue
      if (response.ok) {
        queue = queue.slice(batch.length)
        return 'sent'
      }
      const body = await response.json().catch(() => null)
      const detail = body?.error
        ? `${body.error.code}: ${body.error.message}`
        : `HTTP ${response.status}`
      if (response.status >= 500 || LIVE_RETRYABLE.has(response.status)) {
        log(`will retry readings: ${detail}`)
        return 'retry'
      }
      if (response.status === 403) {
        const error = new Error(`Readings refused: ${detail}`)
        error.permanent = true
        throw error
      }
      queue = queue.slice(batch.length)
      log(`dropped ${batch.length} readings the server refused: ${detail}`)
      return 'dropped'
    }
    return 'retry'
  }
  return {
    push(readings) {
      queue.push(...readings)
      if (queue.length > LIVE_BUFFER_LIMIT) {
        queue = queue.slice(queue.length - LIVE_BUFFER_LIMIT)
      }
    },
    flush,
    get pending() {
      return queue.length
    },
  }
}

/** Reads lines from a network port, reconnecting when it drops. */
function followNetwork(source, onLine, log, stopped) {
  let buffered = ''
  const open = () => {
    if (stopped()) return
    const socket = connect({ host: source.host, port: source.port })
    socket.setEncoding('utf8')
    socket.on('connect', () =>
      log(`connected to ${source.host}:${source.port}`),
    )
    socket.on('data', (data) => {
      buffered += data
      const parts = buffered.split(/\r?\n/)
      buffered = parts.pop() ?? ''
      for (const line of parts) onLine(line)
    })
    socket.on('error', (error) =>
      log(`${source.host}:${source.port}: ${error.message}`),
    )
    socket.on('close', () => {
      buffered = ''
      setTimeout(open, 5000)
    })
  }
  open()
}

/** The settings file named by `--config`, else the one beside this script. */
export async function loadConfigFile(argv, scriptDir) {
  const at = argv.indexOf('--config')
  const explicit = at >= 0 ? argv[at + 1] : undefined
  if (at >= 0 && !explicit) throw new Error('--config needs a value.')
  const path = explicit ? resolve(explicit) : join(scriptDir, CONFIG_FILE_NAME)
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (!explicit && error.code === 'ENOENT') return {}
    throw new Error(`Can't read ${path}: ${error.message}`)
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }
  } catch {
    // fall through to the error below
  }
  throw new Error(`${path} is not a valid settings file.`)
}

async function main() {
  const argv = process.argv.slice(2)
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const options = parseArgs(
    argv,
    process.env,
    await loadConfigFile(argv, scriptDir),
  )
  const agent = createAgent(options)
  let stopping = false
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      stopping = true
    })
  }
  const pause = (seconds) =>
    new Promise((resolve) => setTimeout(resolve, seconds * 1000))
  const jobs = []
  if (options.live.length > 0)
    jobs.push(runLive(options, agent, () => stopping))
  if (options.connector && options.dir) {
    await mkdir(options.dir, { recursive: true })
    console.log(
      `watching ${options.dir} for .${options.extensions.join(', .')} → ${options.url} (${options.connector})`,
    )
    jobs.push(
      (async () => {
        do {
          try {
            await agent.ensureToken()
            await agent.scan()
          } catch (error) {
            console.error(`scan failed: ${error.message}`)
            if (error.permanent) process.exit(1)
          }
          if (options.once) break
          await pause(options.intervalSeconds)
        } while (!stopping)
      })(),
    )
  }
  await Promise.all(jobs)
}

async function runLive(options, agent, stopped) {
  const log = (line) => console.log(line)
  const sender = createLiveSender(options, {
    ensureToken: agent.ensureToken,
    log,
  })
  for (const source of options.live) {
    const parser = createLineParser(source)
    const take = (line) => {
      const readings = parser.parse(line)
      if (readings.length) sender.push(readings)
    }
    if (source.kind === 'file') {
      const tail = createTail(resolve(source.path), {
        fromStart: source.fromStart === true,
      })
      log(`following ${source.path} → ${options.url}`)
      ;(async () => {
        while (!stopped()) {
          try {
            const { lines, header } = await tail.poll()
            if (header) parser.parse(header)
            lines.forEach(take)
          } catch (error) {
            log(`${source.path}: ${error.message}`)
          }
          await new Promise((done) => setTimeout(done, 1000))
        }
      })()
    } else {
      log(`reading from ${source.host}:${source.port} → ${options.url}`)
      followNetwork(source, take, log, stopped)
    }
  }
  while (!stopped()) {
    try {
      await sender.flush()
    } catch (error) {
      console.error(error.message)
      if (error.permanent) process.exit(1)
    }
    await new Promise((done) => setTimeout(done, 1000))
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
