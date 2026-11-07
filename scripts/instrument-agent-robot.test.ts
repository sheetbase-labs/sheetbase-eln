/**
 * The robot side of the folder agent: what an Opentrons run is read back as,
 * how a file robot is handed a worklist, and how a job moves from queued to
 * complete without anything starting until a person says so.
 */
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createFileDriver,
  createOpentronsDriver,
  createRobotRunner,
  opentronsEntries,
  parseArgs,
} from './instrument-agent.mjs'
import type {
  AgentOptions,
  RobotDriver,
  RobotJob,
} from './instrument-agent.mjs'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'robot-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const run = {
  labware: [
    { id: 'lw-src', location: { slotName: '1' } },
    { id: 'lw-dst', location: { slotName: '2' } },
  ],
}
const cmd = (
  commandType: string,
  wellName: string,
  volume: number,
  status = 'succeeded',
  labwareId = 'lw-src',
) => ({
  commandType,
  status,
  params: { wellName, volume, labwareId },
})

describe('reading an Opentrons run back', () => {
  it('pairs each aspirate with the dispense after it and adds up split transfers', () => {
    const entries = opentronsEntries(run, [
      cmd('aspirate', 'A1', 200),
      cmd('dispense', 'B1', 200, 'succeeded', 'lw-dst'),
      cmd('aspirate', 'A1', 100),
      cmd('dispense', 'B1', 100, 'succeeded', 'lw-dst'),
      cmd('aspirate', 'A2', 50),
      cmd('dispense', 'B2', 50, 'succeeded', 'lw-dst'),
    ])
    expect(entries).toEqual([
      { sourceWell: 'A1', destWell: 'B1', actualUl: 300, status: 'ok' },
      { sourceWell: 'A2', destWell: 'B2', actualUl: 50, status: 'ok' },
    ])
  })

  it('marks a transfer failed when a command in it did not succeed', () => {
    const entries = opentronsEntries(run, [
      cmd('aspirate', 'A1', 50, 'failed'),
      cmd('dispense', 'B1', 50, 'failed', 'lw-dst'),
    ])
    expect(entries).toEqual([
      { sourceWell: 'A1', destWell: 'B1', actualUl: 0, status: 'failed' },
    ])
  })

  it('ignores commands that move no liquid', () => {
    expect(
      opentronsEntries(run, [
        { commandType: 'pickUpTip', status: 'succeeded', params: {} },
      ]),
    ).toEqual([])
    expect(opentronsEntries(undefined, undefined)).toEqual([])
  })
})

/** A robot that answers like the Opentrons robot server. */
function fakeRobot(initialStatus = 'idle') {
  const calls: Array<{ method: string; path: string; body?: unknown }> = []
  const state = { status: initialStatus }
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname + new URL(url).search
    const method = init.method ?? 'GET'
    calls.push({
      method,
      path,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    })
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status })
    if (method === 'POST' && path === '/protocols')
      return json({ data: { id: 'proto-1' } }, 201)
    if (method === 'POST' && path === '/runs')
      return json({ data: { id: 'run-1' } }, 201)
    if (method === 'POST' && path.endsWith('/actions')) {
      const action = (
        JSON.parse(init.body as string) as { data: { actionType: string } }
      ).data.actionType
      state.status = action === 'play' ? 'running' : 'stopped'
      return json({ data: {} }, 201)
    }
    if (method === 'GET' && path === '/runs/run-1')
      return json({ data: { status: state.status, ...run } })
    if (method === 'GET' && path.startsWith('/runs/run-1/commands'))
      return json({
        data: [
          cmd('aspirate', 'A1', 20),
          cmd('dispense', 'B1', 20, 'succeeded', 'lw-dst'),
        ],
      })
    return json({ errors: [{ detail: 'no such thing' }] }, 404)
  }) as unknown as typeof fetch
  return { calls, state, fetchImpl }
}

describe('the Opentrons driver', () => {
  const job = {
    id: 'j1',
    number: 3,
    status: 'queued',
    remoteRef: null,
    file: { name: 'ij-0003-plate.py', content: 'print(1)' },
  } as RobotJob

  it('uploads the protocol, makes a run and does not start it', async () => {
    const robot = fakeRobot()
    const driver = createOpentronsDriver(
      { driver: 'opentrons', address: 'http://ot2:31950/' },
      { fetch: robot.fetchImpl },
    )
    const staged = await driver.stage(job)
    expect(staged.remoteRef).toBe('run-1')
    expect(robot.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /protocols',
      'POST /runs',
    ])
    expect(robot.state.status).toBe('idle')
  })

  it('plays only when told to, and reads the finished run back', async () => {
    const robot = fakeRobot()
    const driver = createOpentronsDriver(
      { driver: 'opentrons', address: 'http://ot2:31950' },
      { fetch: robot.fetchImpl },
    )
    const staged = { ...job, status: 'staged', remoteRef: 'run-1' }
    expect((await driver.poll(staged)).status).toBe('staged')
    await driver.start({ ...staged, status: 'starting' })
    expect((await driver.poll({ ...staged, status: 'running' })).status).toBe(
      'running',
    )
    robot.state.status = 'succeeded'
    const done = await driver.poll({ ...staged, status: 'running' })
    expect(done.status).toBe('complete')
    expect(done.entries).toEqual([
      { sourceWell: 'A1', destWell: 'B1', actualUl: 20, status: 'ok' },
    ])
  })

  it('reports a failed run with the robot’s reason', async () => {
    const robot = fakeRobot('failed')
    const driver = createOpentronsDriver(
      { driver: 'opentrons', address: 'http://ot2:31950' },
      { fetch: robot.fetchImpl },
    )
    const seen = await driver.poll({
      ...job,
      status: 'running',
      remoteRef: 'run-1',
    })
    expect(seen.status).toBe('failed')
  })
})

describe('the file driver', () => {
  it('keeps the worklist in staging until Start, then reads the log the software writes', async () => {
    const driver = createFileDriver({ driver: 'file', dir })
    const job = {
      id: 'j',
      number: 1,
      status: 'queued',
      remoteRef: null,
      file: { name: 'ij-0001-a.csv', content: 'a,b' },
    } as RobotJob
    const staged = await driver.stage(job)
    expect(staged.remoteRef).toBe('ij-0001-a.csv')
    expect(await readdir(dir)).toEqual(['staging'])

    const running = { ...job, status: 'starting', remoteRef: 'ij-0001-a.csv' }
    await driver.start(running)
    expect((await readdir(dir)).sort()).toEqual(['ij-0001-a.csv', 'staging'])
    expect((await driver.poll({ ...running, status: 'running' })).status).toBe(
      'running',
    )

    await mkdir(join(dir, 'logs'))
    await writeFile(
      join(dir, 'logs', 'ij-0001-a.log.csv'),
      'source_well,dest_well,volume\nA1,B1,20\n',
    )
    const done = await driver.poll({ ...running, status: 'running' })
    expect(done.status).toBe('complete')
    expect(done.runLog).toContain('A1,B1,20')
    expect(await readFile(join(dir, 'staging', 'ij-0001-a.csv'), 'utf8')).toBe(
      'a,b',
    )
  })
})

function sheetbase(jobs: Array<Record<string, unknown>>) {
  const reports: Array<Record<string, unknown>> = []
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    if (body.action === 'list')
      return new Response(JSON.stringify({ jobs }), { status: 200 })
    reports.push(body)
    return new Response(JSON.stringify({ job: { id: body.jobId } }), {
      status: 200,
    })
  }) as unknown as typeof fetch
  return { reports, fetchImpl }
}

function fakeDriver(
  overrides: Partial<RobotDriver> = {},
): RobotDriver & { started: string[] } {
  const started: string[] = []
  return {
    name: 'fake',
    started,
    stage: async () => ({ remoteRef: 'r1', message: 'On the robot' }),
    start: async (job) => {
      started.push(job.id)
      return { message: 'Started' }
    },
    poll: async (job) => ({
      status: job.status === 'staged' ? 'staged' : 'running',
    }),
    stop: async () => {},
    ...overrides,
  }
}

const robotOptions = {
  url: 'http://eln.test',
  instrumentId: '11111111-1111-4111-8111-111111111111',
  robot: { driver: 'file', dir: '/x' },
} as unknown as AgentOptions

describe('working through the jobs', () => {
  it('stages a queued job and leaves it waiting for a person', async () => {
    const sb = sheetbase([
      {
        id: 'j1',
        number: 1,
        status: 'queued',
        file: { name: 'a.csv', content: '' },
      },
    ])
    const driver = fakeDriver()
    const runner = createRobotRunner(robotOptions, {
      fetch: sb.fetchImpl,
      log: () => {},
      ensureToken: async () => 't',
      driver,
    })
    await runner.pass()
    expect(sb.reports).toMatchObject([
      { jobId: 'j1', status: 'staged', remoteRef: 'r1' },
    ])
    expect(driver.started).toEqual([])
  })

  it('starts the robot only for a job a person has started', async () => {
    const sb = sheetbase([
      { id: 'j1', number: 1, status: 'staged', remoteRef: 'r1' },
      { id: 'j2', number: 2, status: 'starting', remoteRef: 'r2' },
    ])
    const driver = fakeDriver()
    const runner = createRobotRunner(robotOptions, {
      fetch: sb.fetchImpl,
      log: () => {},
      ensureToken: async () => 't',
      driver,
    })
    await runner.pass()
    expect(driver.started).toEqual(['j2'])
    expect(sb.reports).toMatchObject([{ jobId: 'j2', status: 'running' }])
  })

  it('sends the robot’s log back with a finished job', async () => {
    const sb = sheetbase([
      { id: 'j1', number: 1, status: 'running', remoteRef: 'r1' },
    ])
    const driver = fakeDriver({
      poll: async () => ({
        status: 'complete',
        entries: [
          { sourceWell: 'A1', destWell: 'B1', actualUl: 20, status: 'ok' },
        ],
      }),
    })
    const runner = createRobotRunner(robotOptions, {
      fetch: sb.fetchImpl,
      log: () => {},
      ensureToken: async () => 't',
      driver,
    })
    await runner.pass()
    expect(sb.reports[0]).toMatchObject({
      status: 'complete',
      entries: [{ sourceWell: 'A1', actualUl: 20 }],
    })
  })

  it('tells Sheetbase when the robot will not take a job', async () => {
    const sb = sheetbase([
      {
        id: 'j1',
        number: 1,
        status: 'queued',
        file: { name: 'a.csv', content: '' },
      },
    ])
    const driver = fakeDriver({
      stage: async () => {
        throw new Error('The robot could not read the protocol.')
      },
    })
    const runner = createRobotRunner(robotOptions, {
      fetch: sb.fetchImpl,
      log: () => {},
      ensureToken: async () => 't',
      driver,
    })
    await runner.pass()
    expect(sb.reports).toMatchObject([
      { status: 'failed', message: 'The robot could not read the protocol.' },
    ])
  })

  it('stops a job that was asked to stop', async () => {
    const sb = sheetbase([
      {
        id: 'j1',
        number: 1,
        status: 'running',
        remoteRef: 'r1',
        cancelRequested: true,
      },
    ])
    let stopped = false
    const driver = fakeDriver({
      stop: async () => {
        stopped = true
      },
    })
    const runner = createRobotRunner(robotOptions, {
      fetch: sb.fetchImpl,
      log: () => {},
      ensureToken: async () => 't',
      driver,
    })
    await runner.pass()
    expect(stopped).toBe(true)
    expect(sb.reports).toMatchObject([{ status: 'cancelled' }])
  })
})

describe('settings', () => {
  it('takes a robot from flags and needs its address or folder', () => {
    const base = ['--url', 'http://x', '--instrument', 'i']
    const env = { SHEETBASE_CREDENTIAL: 'c' }
    expect(
      parseArgs(
        [
          ...base,
          '--robot-driver',
          'opentrons',
          '--robot-address',
          'http://ot',
        ],
        env,
      ).robot,
    ).toMatchObject({ driver: 'opentrons', address: 'http://ot' })
    expect(() =>
      parseArgs([...base, '--robot-driver', 'opentrons'], env),
    ).toThrow(/address/)
    expect(() => parseArgs([...base, '--robot-driver', 'file'], env)).toThrow(
      /folder/,
    )
    expect(() =>
      parseArgs(
        [...base, '--robot-driver', 'hamster', '--robot-dir', 'x'],
        env,
      ),
    ).toThrow(/driver/)
  })
})
