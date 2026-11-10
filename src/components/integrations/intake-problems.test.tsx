/**
 * Files an instrument sent that couldn’t be read are listed with their reason,
 * and can be tried again, tried with another parser, or dismissed.
 *
 * The screen is driven through the real data client and the real intake calls:
 * a fake transport stands in for the browser's `fetch`, so what a case asserts
 * is the request the app really sends and the answer it really reads.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { dropSharedReads } from '#/lib/data-client'
import type { IntakeProblem } from '#/lib/connectors/intake-client'
import type { ParserSettingsRow } from '#/lib/parser-settings'
import { IntakeProblems } from './intake-problems'

/** One JSON value, as the wire carries it. */
const jsonSchema = z.json()

type WireJson = z.infer<typeof jsonSchema>

/** A list of rows as the wire carries them. */
const rowsWireSchema = z.array(jsonSchema)

type WireRows = z.infer<typeof rowsWireSchema>

/** One request the app made, as the transport received it. */
interface SentRequest {
  method: string
  path: string
  body?: WireJson
}

/** What the transport answers, set by each case. */
interface Answers {
  /** Rows as the transport carries them: the fixture below is JSON on the wire. */
  problems: WireRows
  parsers: WireRows
  /** The answer to a retry: its status and JSON body. */
  intake: { status: number; body: WireJson }
}

// The screen builds its data client when its module loads, so the transport has
// to be in place before that import runs.
const transport = vi.hoisted(() => {
  const sent: SentRequest[] = []

  const answers: Answers = {
    problems: [],
    parsers: [],
    intake: { status: 200, body: {} },
  }

  const json = (body: WireJson, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  /** A request's address, wherever the caller put it. */
  const addressOf = (input: RequestInfo | URL) =>
    z.union([z.string(), z.instanceof(URL)]).safeParse(input).data ??
    z.instanceof(Request).parse(input).url

  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(addressOf(input), 'http://sheetbase.test')
    const method = init?.method ?? 'GET'
    const rawBody = z.string().safeParse(init?.body).data
    const body = rawBody === undefined ? undefined : JSON.parse(rawBody)
    const entry: SentRequest = { method, path: url.pathname }

    if (body !== undefined) entry.body = body
    sent.push(entry)

    if (url.pathname === '/api/db/intake_failures')
      return json(answers.problems)

    if (url.pathname === '/api/db/parsers') return json(answers.parsers)

    if (url.pathname === '/api/db/rpc/resolve_intake_failure') return json({})

    if (url.pathname === '/api/connectors/intake')
      return json(answers.intake.body, answers.intake.status)

    return json({ error: { message: `No route for ${url.pathname}` } }, 404)
  }

  vi.stubGlobal('fetch', fetchMock)

  return { answers, sent }
})

const problem: IntakeProblem = {
  id: 'f1',
  connector_id: 'c1',
  instrument_id: 'i1',
  file_name: 'run-12.csv',
  source: 'agent',
  code: 'parser_unrecognised',
  message: 'This file isn’t in the shape qPCR export reads.',
  parser_key: 'qpcr',
  file_record_id: 'r1',
  attempts: 2,
  created_at: '2026-10-29T09:00:00Z',
  last_attempt_at: '2026-10-29T09:30:00Z',
}

const parsers: ParserSettingsRow[] = [
  {
    id: 'p1',
    key: 'qpcr',
    name: 'qPCR export',
    format: 'csv',
    instrument_id: null,
    instruments: null,
    parser_versions: [
      {
        id: 'v1',
        version: 1,
        status: 'approved',
        signature: {},
        mapping: {},
        test_result: null,
        validated_at: null,
        approved_at: null,
        approved_by_user_id: null,
      },
    ],
  },
  {
    id: 'p2',
    key: 'draft-only',
    name: 'Draft only',
    format: 'csv',
    instrument_id: null,
    instruments: null,
    parser_versions: [
      {
        id: 'v2',
        version: 1,
        status: 'draft',
        signature: {},
        mapping: {},
        test_result: null,
        validated_at: null,
        approved_at: null,
        approved_by_user_id: null,
      },
    ],
  },
]

/** What the intake server answers when a file is read. */
function readRows(rowCount: number) {
  return {
    runId: 'run-1',
    alreadyCompleted: false,
    datasetId: 'd1',
    datasetRevision: 1,
    rowCount,
    parser: 'qpcr',
    fileRecordId: 'r1',
    warnings: [],
  }
}

/** The last request made to one path, or undefined when it was never called. */
function requestTo(path: string): SentRequest | undefined {
  return transport.sent.find((entry) => entry.path === path)
}

function renderList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={client}>
      <IntakeProblems workspaceId="w1" instrumentId="i1" canManage />
    </QueryClientProvider>,
  )
}

describe('IntakeProblems', () => {
  beforeEach(() => {
    // Reads are shared for a moment across screens; a case starts from none.
    dropSharedReads()
    transport.sent.length = 0
    transport.answers.problems = rowsWireSchema.parse([problem])
    transport.answers.parsers = rowsWireSchema.parse(parsers)
    transport.answers.intake = { status: 200, body: readRows(1) }
  })
  afterEach(cleanup)

  it('shows the file, the reason and how often it was tried', async () => {
    renderList()
    expect(await screen.findByText('run-12.csv')).toBeTruthy()
    expect(screen.getByText('Not in the format this parser reads')).toBeTruthy()
    expect(screen.getByText(/2 attempts/)).toBeTruthy()
    expect(screen.getByText(/Sent by the folder agent/)).toBeTruthy()
  })

  it('renders nothing when every file was read', async () => {
    transport.answers.problems = []
    const { container } = renderList()
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('tries the file again and says what landed', async () => {
    transport.answers.intake = { status: 200, body: readRows(12) }
    renderList()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Try run-12.csv again' }),
    )
    await waitFor(() =>
      expect(requestTo('/api/connectors/intake')).toMatchObject({
        method: 'POST',
        body: { kind: 'retry', failureId: 'f1', parserKey: null },
      }),
    )
    expect(
      await screen.findByText('run-12.csv imported: 12 rows.'),
    ).toBeTruthy()
  })

  it('offers only approved parsers when choosing another', async () => {
    transport.answers.intake = { status: 200, body: readRows(3) }
    renderList()
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Use a different parser for run-12.csv',
      }),
    )
    const picker = await screen.findByLabelText('Parser for run-12.csv')
    expect(screen.getByRole('option', { name: 'qPCR export' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Draft only' })).toBeNull()
    await userEvent.selectOptions(picker, 'qpcr')
    await userEvent.click(
      screen.getByRole('button', { name: 'Try with this parser' }),
    )
    await waitFor(() =>
      expect(requestTo('/api/connectors/intake')).toMatchObject({
        method: 'POST',
        body: { kind: 'retry', failureId: 'f1', parserKey: 'qpcr' },
      }),
    )
  })

  it('shows the newest reason when trying again still fails', async () => {
    transport.answers.intake = {
      status: 422,
      body: {
        error: {
          code: 'parser_not_approved',
          message: 'qPCR export isn’t approved yet.',
        },
        failureId: 'f1',
      },
    }
    renderList()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Try run-12.csv again' }),
    )
    expect(await screen.findByText('Parser isn’t approved yet')).toBeTruthy()
  })

  it('shows five rows and the rest on request', async () => {
    transport.answers.problems = rowsWireSchema.parse(
      Array.from({ length: 8 }, (_, i) => ({
        ...problem,
        id: `f${i}`,
        file_name: `run-${i}.csv`,
      })),
    )
    renderList()
    await screen.findByText('run-0.csv')
    expect(screen.queryByText('run-5.csv')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show all 8' }))
    expect(screen.getByText('run-7.csv')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.queryByText('run-5.csv')).toBeNull()
  })

  it('dismisses a problem', async () => {
    renderList()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dismiss run-12.csv' }),
    )
    await waitFor(() =>
      expect(requestTo('/api/db/rpc/resolve_intake_failure')).toMatchObject({
        method: 'POST',
        body: { p_failure_id: 'f1', p_resolution: 'dismissed' },
      }),
    )
  })
})
