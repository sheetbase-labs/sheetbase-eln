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
 * A file is sent once its size and modified time have stopped changing, so a
 * file the instrument is still writing is left alone. Sent files move to
 * `processed/`; files the server refuses for good (bad format, no mapping)
 * move to `failed/` with a `.error.txt` beside them; anything that might work
 * later (network down, server error, rate limit, stale Dataset revision) stays
 * where it is and is retried.
 */
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
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
  }
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
    else if (flag === '--config')
      next() // read before parsing, see main()
    else throw new Error(`Unknown option ${flag}.`)
  }
  for (const [name, value] of [
    ['the Sheetbase address (url)', options.url],
    ['the access token (credential)', options.credential],
    ['the instrument (connector)', options.connector],
    ['the results folder (dir)', options.dir],
  ]) {
    if (!value) {
      throw new Error(
        `Missing ${name}. Download the agent again from the instrument's page in Sheetbase, or set it in ${CONFIG_FILE_NAME}.`,
      )
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
  await mkdir(options.dir, { recursive: true })
  const agent = createAgent(options)
  let stopping = false
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      stopping = true
    })
  }
  console.log(
    `watching ${options.dir} for .${options.extensions.join(', .')} → ${options.url} (${options.connector})`,
  )
  do {
    try {
      await agent.ensureToken()
      await agent.scan()
    } catch (error) {
      console.error(`scan failed: ${error.message}`)
      if (error.permanent) process.exit(1)
    }
    if (options.once) break
    await new Promise((resolve) =>
      setTimeout(resolve, options.intervalSeconds * 1000),
    )
  } while (!stopping)
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
