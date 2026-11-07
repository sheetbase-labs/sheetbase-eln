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
 * Robots: an instrument that does the pipetting can also be driven. Sheetbase
 * queues a worklist for it; the agent puts the run on the robot, a person presses
 * Start in Sheetbase, and the robot's log goes back so the transfers, lineage and
 * stock withdrawals are recorded against the experiment.
 *
 *   node instrument-agent.mjs --instrument <id> --robot-driver opentrons --robot-address http://192.168.1.50:31950
 *   node instrument-agent.mjs --instrument <id> --robot-driver file --robot-dir D:\\RobotWorklists
 *
 * `opentrons` talks to the robot's HTTP API. `file` writes the worklist to a
 * staging folder, copies it into the folder the robot's own software watches
 * when a person presses Start, and reads the log the software writes beside it
 * (`<worklist>.log.csv`). A person always starts the run.
 *
 * A file is sent once its size and modified time have stopped changing, so a
 * file the instrument is still writing is left alone. Sent files move to
 * `processed/`; files the server refuses for good (bad format, no mapping)
 * move to `failed/` with a `.error.txt` beside them; anything that might work
 * later (network down, server error, rate limit, stale Dataset revision) stays
 * where it is and is retried.
 */
import {
  copyFile,
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
export const ROBOT_DRIVERS = ['opentrons', 'file']

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
    robot:
      fileConfig.robot && typeof fileConfig.robot === 'object'
        ? { ...fileConfig.robot }
        : null,
  }
  const adHoc = { feed: '', unit: '' }
  const robotFlags = {}
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
    } else if (flag === '--robot-driver') robotFlags.driver = next()
    else if (flag === '--robot-address') robotFlags.address = next()
    else if (flag === '--robot-dir') robotFlags.dir = next()
    else if (flag === '--feed') adHoc.feed = next()
    else if (flag === '--unit') adHoc.unit = next()
    else if (flag === '--config')
      next() // read before parsing, see main()
    else throw new Error(`Unknown option ${flag}.`)
  }
  for (const source of options.live) {
    if (adHoc.feed && !source.feed) source.feed = adHoc.feed
    if (adHoc.unit && !source.unit) source.unit = adHoc.unit
  }
  if (Object.keys(robotFlags).length > 0) {
    options.robot = { ...(options.robot ?? {}), ...robotFlags }
  }
  if (options.robot) {
    if (!ROBOT_DRIVERS.includes(options.robot.driver)) {
      throw new Error(
        `The robot driver must be one of: ${ROBOT_DRIVERS.join(', ')}.`,
      )
    }
    if (options.robot.driver === 'opentrons' && !options.robot.address) {
      throw new Error('An Opentrons robot needs its address (robot.address).')
    }
    if (options.robot.driver === 'file' && !options.robot.dir) {
      throw new Error('A file robot needs its folder (robot.dir).')
    }
  }
  const live = options.live.length > 0 || Boolean(options.robot)
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

// ---------------------------------------------------------------------------
// Robots
// ---------------------------------------------------------------------------

/**
 * What an Opentrons run did, as transfers. The worklist protocol moves liquid
 * with `pipette.transfer`, which the robot breaks into aspirate and dispense
 * commands; each aspirate is paired with the dispense that follows it, and
 * pairs between the same two wells are added up (a transfer larger than the
 * pipette is several of them). A command that did not succeed marks its
 * transfer as failed. Pure, so it can be tested without a robot.
 */
export function opentronsEntries(run, commands) {
  const slotOf = new Map()
  for (const item of run?.labware ?? []) {
    const slot = item?.location?.slotName
    if (item?.id && slot !== undefined) slotOf.set(item.id, String(slot))
  }
  const entries = []
  let pending = null
  for (const command of commands ?? []) {
    const type = command?.commandType
    const params = command?.params ?? {}
    const ok = command?.status === 'succeeded'
    if (type === 'aspirate') {
      pending = {
        well: String(params.wellName ?? '').toUpperCase(),
        slot: slotOf.get(params.labwareId) ?? null,
        volume: Number(params.volume ?? 0),
        ok,
      }
    } else if (type === 'dispense' && pending) {
      const destWell = String(params.wellName ?? '').toUpperCase()
      const last = entries.at(-1)
      const moved = ok && pending.ok ? Number(params.volume ?? 0) : 0
      if (
        last &&
        last.sourceWell === pending.well &&
        last.destWell === destWell
      ) {
        last.actualUl += moved
        if (!(ok && pending.ok)) last.status = 'failed'
      } else {
        entries.push({
          sourceWell: pending.well,
          destWell,
          actualUl: moved,
          status: ok && pending.ok ? 'ok' : 'failed',
        })
      }
      pending = null
    }
  }
  return entries
}

/** The Opentrons HTTP API (robot server), one run per job. */
export function createOpentronsDriver(config, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch
  const base = String(config.address).replace(/\/+$/, '')
  const headers = { 'Opentrons-Version': '3' }
  async function call(method, path, body) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers:
        body instanceof FormData
          ? headers
          : { ...headers, 'content-type': 'application/json' },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    })
    const text = await response.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      // not JSON
    }
    if (!response.ok) {
      const detail =
        json?.errors?.[0]?.detail ?? json?.message ?? text.slice(0, 200)
      const failure = new Error(
        `The robot answered ${response.status}: ${detail}`,
      )
      failure.robotStatus = response.status
      throw failure
    }
    return json
  }
  return {
    name: 'opentrons',
    /** Put the protocol on the robot and create the run. */
    async stage(job) {
      const form = new FormData()
      form.append(
        'files',
        new Blob([job.file.content], { type: 'text/x-python' }),
        job.file.name,
      )
      const protocol = await call('POST', '/protocols', form)
      const protocolId = protocol?.data?.id
      if (!protocolId) throw new Error('The robot did not accept the protocol.')
      const analysis = protocol?.data?.analysisSummaries?.[0]
      if (analysis?.status === 'not-ok') {
        throw new Error('The robot could not read the protocol.')
      }
      const run = await call('POST', '/runs', { data: { protocolId } })
      const runId = run?.data?.id
      if (!runId) throw new Error('The robot did not create a run.')
      return { remoteRef: runId, message: 'On the robot, waiting for Start' }
    },
    async start(job) {
      try {
        await call('POST', `/runs/${job.remoteRef}/actions`, {
          data: { actionType: 'play' },
        })
      } catch (error) {
        // Already playing: an earlier attempt got through before the news did.
        if (error.robotStatus !== 409) throw error
      }
      return { message: 'Started' }
    },
    /** 'staged' | 'running' | 'complete' | 'failed' | 'cancelled' | 'paused' */
    async poll(job) {
      const run = await call('GET', `/runs/${job.remoteRef}`)
      const status = run?.data?.status
      if (status === 'succeeded') {
        const commands = await call(
          'GET',
          `/runs/${job.remoteRef}/commands?pageLength=20000`,
        )
        return {
          status: 'complete',
          entries: opentronsEntries(run.data, commands?.data),
        }
      }
      if (status === 'failed') {
        return {
          status: 'failed',
          message: run?.data?.errors?.[0]?.detail ?? 'The run failed.',
        }
      }
      if (status === 'stopped') return { status: 'cancelled' }
      if (status === 'idle') return { status: 'staged' }
      return { status: 'running', message: status }
    },
    async stop(job) {
      await call('POST', `/runs/${job.remoteRef}/actions`, {
        data: { actionType: 'stop' },
      })
    },
  }
}

/**
 * A robot whose own software reads a worklist from a folder. The file waits in
 * `staging/` until a person presses Start, then moves into the watched folder;
 * the log the software writes beside it (`<worklist>.log.csv`) ends the job.
 */
export function createFileDriver(config) {
  const dir = resolve(config.dir)
  const staging = join(dir, 'staging')
  const logNames = (name) => {
    const stem = name.replace(/\.[^.]+$/, '')
    return ['csv', 'txt', 'tsv'].flatMap((ext) => [
      join(dir, `${stem}.log.${ext}`),
      join(dir, 'logs', `${stem}.log.${ext}`),
    ])
  }
  return {
    name: 'file',
    async stage(job) {
      await mkdir(staging, { recursive: true })
      await writeFile(join(staging, job.file.name), job.file.content)
      return { remoteRef: job.file.name, message: 'Worklist is ready to start' }
    },
    async start(job) {
      await copyFile(join(staging, job.remoteRef), join(dir, job.remoteRef))
      return { message: 'Worklist given to the robot software' }
    },
    async poll(job) {
      for (const path of logNames(job.remoteRef)) {
        try {
          const info = await stat(path)
          if (info.size === 0) continue
          return {
            status: 'complete',
            runLog: await readFile(path, 'utf8'),
            volumeUnit: config.logVolumeUnit ?? 'ul',
          }
        } catch {
          // not there yet
        }
      }
      return { status: job.status === 'staged' ? 'staged' : 'running' }
    },
    async stop() {
      // The robot software owns the run; the person stops it there.
    },
  }
}

/**
 * Works through the jobs queued for one robot. `pass()` looks once; each job
 * moves at most one step, so a person pressing Start and the robot finishing
 * are noticed on the next passes.
 */
export function createRobotRunner(options, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch
  const log = deps.log ?? ((line) => console.log(line))
  const ensureToken = deps.ensureToken
  const driver =
    deps.driver ??
    (options.robot.driver === 'opentrons'
      ? createOpentronsDriver(options.robot, { fetch: fetchImpl })
      : createFileDriver(options.robot))
  // Last status told to Sheetbase per job, so the same news is not sent twice.
  const told = new Map()

  async function post(body, attempt = 0) {
    const response = await fetchImpl(`${options.url}/api/connectors/jobs`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await ensureToken(attempt > 0)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ instrumentId: options.instrumentId, ...body }),
    })
    if (response.status === 401 && attempt === 0) return post(body, 1)
    const json = await response.json().catch(() => null)
    if (!response.ok) {
      const error = new Error(json?.error?.message ?? `HTTP ${response.status}`)
      error.status = response.status
      throw error
    }
    return json
  }

  async function report(job, status, extra = {}) {
    await post({ action: 'report', jobId: job.id, status, ...extra })
    told.set(job.id, status)
    log(
      `IJ-${String(job.number).padStart(4, '0')}: ${status}${extra.message ? ` (${extra.message})` : ''}`,
    )
  }

  async function step(job) {
    const label = `IJ-${String(job.number).padStart(4, '0')}`
    try {
      if (job.cancelRequested && job.status !== 'queued') {
        if (job.remoteRef) await driver.stop(job).catch(() => {})
        await report(job, 'cancelled', { message: 'Stopped on request' })
        return
      }
      if (job.status === 'queued') {
        const staged = await driver.stage(job)
        await report(job, 'staged', staged)
        return
      }
      if (job.status === 'starting') {
        const started = await driver.start(job)
        await report(job, 'running', { message: started?.message })
        return
      }
      if (job.status === 'staged' || job.status === 'running') {
        const seen = await driver.poll(job)
        if (seen.status === 'complete') {
          await report(job, 'complete', {
            message: 'The robot finished',
            entries: seen.entries,
            runLog: seen.runLog,
            volumeUnit: seen.volumeUnit,
          })
        } else if (seen.status === 'failed' || seen.status === 'cancelled') {
          await report(job, seen.status, { message: seen.message })
        } else if (seen.status === 'running' && job.status === 'staged') {
          // Someone started it on the robot itself.
          await report(job, 'running', { message: 'Started at the robot' })
        }
      }
    } catch (error) {
      if (error.status >= 400 && error.status < 500 && error.status !== 429) {
        log(`${label}: ${error.message}`)
        return
      }
      if (job.status === 'queued') {
        // The robot would not take it. Say so, so the person is not left waiting.
        try {
          await report(job, 'failed', { message: error.message })
        } catch (inner) {
          log(`${label}: ${inner.message}`)
        }
        return
      }
      log(`${label}: ${error.message}`)
    }
  }

  async function pass() {
    const { jobs } = await post({ action: 'list' })
    for (const job of jobs ?? []) await step(job)
    return (jobs ?? []).length
  }
  return { pass }
}

async function runRobot(options, agent, stopped) {
  const runner = createRobotRunner(options, { ensureToken: agent.ensureToken })
  console.log(
    `driving the ${options.robot.driver} robot for instrument ${options.instrumentId} → ${options.url}`,
  )
  const seconds = Math.max(2, Number(options.robot.intervalSeconds ?? 3))
  while (!stopped()) {
    try {
      await runner.pass()
    } catch (error) {
      console.error(`robot: ${error.message}`)
      if (error.permanent) process.exit(1)
    }
    await new Promise((done) => setTimeout(done, seconds * 1000))
  }
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
  if (options.robot) jobs.push(runRobot(options, agent, () => stopping))
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
