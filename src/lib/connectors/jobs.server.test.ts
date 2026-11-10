import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createDataClient } from '../data-client'
import type { PersonalClientClaims } from '../external-token'
import type { JobsDeps } from './jobs.server'
import {
  handleJobs,
  parseJobsBody,
  reconcileJobLog,
  toAgentJob,
} from './jobs.server'

const INSTRUMENT = '11111111-1111-4111-8111-111111111111'
const JOB = '22222222-2222-4222-8222-222222222222'

const rpcJob: Parameters<typeof toAgentJob>[0] = {
  id: JOB,
  number: 4,
  status: 'queued',
  driver: 'opentrons',
  format: 'opentrons',
  labware: { opentronsPipette: 'p20_single_gen2' },
  remoteRef: null,
  cancelRequested: false,
  recordId: null,
  worklist: {
    id: 'w',
    number: 1,
    name: 'Serial dilution',
    sourcePlate: 'S',
    sourceFormat: '96_well',
    destPlate: 'D',
    destFormat: '96_well',
    transfers: [{ sourceWell: 'A1', destWell: 'B2', volumeUl: 15 }],
  },
}

describe('parsing the agent’s request', () => {
  it('needs an action and a robot', () => {
    expect(() => parseJobsBody(null)).toThrow(/JSON/)
    expect(() =>
      parseJobsBody({ action: 'x', instrumentId: INSTRUMENT }),
    ).toThrow(/list or report/)
    expect(() =>
      parseJobsBody({ action: 'list', instrumentId: 'nope' }),
    ).toThrow(/robot/)
    expect(parseJobsBody({ action: 'list', instrumentId: INSTRUMENT })).toEqual(
      { action: 'list', instrumentId: INSTRUMENT },
    )
  })

  it('checks a report', () => {
    const base = { action: 'report', instrumentId: INSTRUMENT, jobId: JOB }
    expect(() => parseJobsBody({ ...base, status: 'queued' })).toThrow(/status/)
    expect(() => parseJobsBody({ ...base, status: 'complete' })).toThrow(
      /entries or runLog/,
    )

    const ok = parseJobsBody({
      ...base,
      status: 'complete',
      entries: [
        { sourceWell: 'a1', destWell: 'b2', actualUl: 15, status: 'ok' },
      ],
    })

    expect(ok.entries?.[0]).toEqual({
      sourceWell: 'A1',
      destWell: 'B2',
      actualUl: 15,
      status: 'ok',
    })
  })

  it('rejects a volume-unit array instead of asserting it to a string', () => {
    const report = {
      action: 'report',
      instrumentId: INSTRUMENT,
      jobId: JOB,
      status: 'running',
    }

    expect(() => parseJobsBody({ ...report, volumeUnit: ['ul'] })).toThrow(
      /volumeUnit/,
    )
    expect(parseJobsBody({ ...report, volumeUnit: 'nl' }).volumeUnit).toBe('nl')
  })
})

describe('what the agent is told', () => {
  it('sends the file only while a job is queued, in the robot’s format', () => {
    const queued = toAgentJob(rpcJob)
    expect(queued.file?.name).toBe('ij-0004-serial-dilution.py')
    expect(queued.file?.content).toContain('p20_single_gen2')
    expect(queued.file?.content).toContain('"A1", "B2", 15')
    expect(toAgentJob({ ...rpcJob, status: 'staged' }).file).toBeUndefined()
  })
})

describe('matching the robot’s log to the worklist', () => {
  const planned = [
    {
      sourcePlate: 'S',
      sourceWell: 'A1',
      destPlate: 'D',
      destWell: 'B2',
      volumeUl: 15,
      label: 'x',
      sampleId: null,
    },
    {
      sourcePlate: 'S',
      sourceWell: 'A2',
      destPlate: 'D',
      destWell: 'B3',
      volumeUl: 15,
      label: 'y',
      sampleId: null,
    },
  ]

  it('reads entries and text logs alike', () => {
    const fromEntries = reconcileJobLog(planned, {
      entries: [
        { sourceWell: 'A1', destWell: 'B2', actualUl: 15, status: 'ok' },
      ],
    })

    expect(fromEntries.map((t) => t.status)).toEqual(['done', 'missing'])

    const fromText = reconcileJobLog(planned, {
      runLog: 'source_well,dest_well,volume\nA1,B2,15\nA2,B3,5\n',
    })

    expect(fromText.map((t) => t.status)).toEqual(['done', 'short'])
  })
  it('refuses a log with nothing in it', () => {
    expect(() => reconcileJobLog(planned, { runLog: 'nothing here' })).toThrow(
      /transfers/,
    )
  })
})

describe('the endpoint', () => {
  const claims: PersonalClientClaims = {
    role: 'authenticated',
    scopes: ['datasets:write'],
    workspace_id: 'w',
    credential_id: 'credential',
    sub: 'user',
    kind: 'personal',
  }

  function request(body: z.core.util.JSONType) {
    return new Request('http://eln.test/api/connectors/jobs', {
      method: 'POST',
      headers: { authorization: 'Bearer abc' },
      body: JSON.stringify(body),
    })
  }

  const deps = (fetchImpl: typeof fetch): JobsDeps => ({
    verifyCredential: async () => claims,
    createClient: () => createDataClient(fetchImpl),
  })

  it('lists jobs through the database', async () => {
    const response = await handleJobs(
      request({ action: 'list', instrumentId: INSTRUMENT }),
      deps(async () => Response.json([rpcJob])),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      jobs: [{ id: JOB, file: { name: 'ij-0004-serial-dilution.py' } }],
    })
  })

  it('completes a job with the worklist matched to the log', async () => {
    const calls: Array<{ name: string; args: z.core.util.JSONType }> = []

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        'http://eln.test',
      )

      if (url.pathname === '/api/db/instrument_jobs')
        return Response.json([{ worklist_id: 'w' }])

      if (url.pathname === '/api/db/plate_worklists')
        return Response.json([
          {
            transfers: [{ sourceWell: 'A1', destWell: 'B2', volumeUl: 15 }],
            source_plate: 'S',
            dest_plate: 'D',
          },
        ])

      const args = z.json().parse(JSON.parse(z.string().parse(init?.body)))

      calls.push({ name: url.pathname.split('/').at(-1) ?? '', args })

      return Response.json({ id: JOB, number: 4, status: 'complete' })
    }

    const response = await handleJobs(
      request({
        action: 'report',
        instrumentId: INSTRUMENT,
        jobId: JOB,
        status: 'complete',
        entries: [
          { sourceWell: 'A1', destWell: 'B2', actualUl: 15, status: 'ok' },
        ],
      }),
      deps(fetchImpl),
    )

    expect(response.status).toBe(200)
    expect(calls[0]).toMatchObject({
      name: 'agent_report_instrument_job',
      args: { p_reconciled: [{ status: 'done', movedUl: 15 }] },
    })
  })

  it('answers a refusal from the database as final, not as a retry', async () => {
    const response = await handleJobs(
      request({
        action: 'report',
        instrumentId: INSTRUMENT,
        jobId: JOB,
        status: 'staged',
      }),
      deps(async () => {
        throw new Error('this job is cancelled')
      }),
    )

    expect(response.status).toBe(422)
  })

  it('refuses a service credential', async () => {
    const response = await handleJobs(
      request({ action: 'list', instrumentId: INSTRUMENT }),
      {
        verifyCredential: async () => ({ ...claims, role: 'api_client' }),
        createClient: () => {
          throw new Error(
            'Service credentials must be refused before data access.',
          )
        },
      },
    )

    expect(response.status).toBe(403)
  })
})
