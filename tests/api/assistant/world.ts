import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import type { UIMessage } from 'ai'

import { startMockModel } from './mock-model'
import type { MockModel, ModelScript } from './mock-model'
import { signedIn } from './auth-mock'

/**
 * A real workspace for an assistant conversation: a signed-in owner, an
 * AI-enabled workspace pointed at the scripted model, and the migrated
 * database behind PostgREST. `World.ask` runs a turn through the real chat
 * route; `World.apply` presses a card's button through the code the chat card
 * itself runs.
 */

export interface Card {
  callId: string
  tool: string
  /** The proposal the server sent back, as the chat card receives it. */
  proposal: Proposal
}

type Proposal = import('#/lib/assistant-proposals').AssistantProposal

export interface ToolStep {
  id: string
  name: string
  input: unknown
  ok: boolean
  error?: string
  refs?: string[]
}

export interface Turn {
  text: string
  steps: ToolStep[]
  cards: Card[]
  /** An error part, when the turn could not be answered. */
  error?: string
}

export interface CardResult {
  status: 'applied' | 'failed' | 'needs_signature'
  reason?: string
  opened?: string
}

export class World {
  readonly model: MockModel
  readonly admin: Client
  readonly workspaceId: string
  readonly userId: string
  readonly messages: UIMessage[] = []
  private readonly handle: (request: Request) => Promise<Response>
  private readonly token: () => Promise<string>

  constructor(init: {
    model: MockModel
    admin: Client
    workspaceId: string
    userId: string
    handle: (request: Request) => Promise<Response>
    token: () => Promise<string>
  }) {
    this.model = init.model
    this.admin = init.admin
    this.workspaceId = init.workspaceId
    this.userId = init.userId
    this.handle = init.handle
    this.token = init.token
  }

  /** Scripts the next model steps. */
  script(script: ModelScript) {
    this.model.use(script)
  }

  /** Starts a fresh conversation. */
  newChat() {
    this.messages.length = 0
  }

  /** One question, one streamed answer, through the real route. */
  async ask(
    question: string,
    extra: Record<string, unknown> = {},
  ): Promise<Turn> {
    const { toChatTurns } = await import('#/lib/assistant-chat')

    this.messages.push({
      id: randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: question }],
    })

    const response = await this.handle(
      new Request('http://sheetbase.test/api/assistant/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: this.workspaceId,
          messages: toChatTurns(this.messages),
          timeZone: 'Europe/London',
          ...extra,
        }),
      }),
    )

    if (!response.ok) {
      throw new Error(`Chat route answered ${response.status}`)
    }

    const turn = await readStream(await response.text())

    this.messages.push({
      id: randomUUID(),
      role: 'assistant',
      parts: [
        ...turn.steps.flatMap((step) => {
          const card = turn.cards.find((entry) => entry.callId === step.id)

          return [
            {
              type: 'dynamic-tool' as const,
              toolName: step.name,
              toolCallId: step.id,
              state: 'output-available' as const,
              input: step.input ?? {},
              output: card
                ? { ok: true, proposal: card.proposal }
                : { ok: step.ok, refs: step.refs ?? [] },
            },
          ]
        }),
        { type: 'text' as const, text: turn.text },
      ],
    })

    return turn
  }

  /**
   * Presses a card's Apply button as the signed-in person: the same code the
   * chat card runs, then the outcome is remembered so the next question tells
   * the assistant what the card came to, as the app does.
   */
  async apply(card: Card): Promise<CardResult> {
    const [{ createServerDataClient }, apply, plans, stepServer] =
      await Promise.all([
        import('#/lib/server-data-client.server'),
        import('#/lib/assistant-apply'),
        import('#/features/plans/plan'),
        import('#/features/plans/step.server'),
      ])

    const client = createServerDataClient(await this.token())
    const proposal = card.proposal
    let result: CardResult

    const { buildPlanStepAnswer } = stepServer

    if (proposal.action && plans.isPlanAction(proposal.action)) {
      const failures: string[] = []
      let opened: string | undefined

      const outcome = await plans.runPlan({
        steps: proposal.action.steps,
        from: 0,
        pauseDestructive: false,
        runAll: true,
        execute: async (step) => {
          // What the chat card does for each step when its turn comes: build
          // it now (so it finds what earlier steps made), then apply it.
          const built = await buildPlanStepAnswer(
            {
              workspaceId: this.workspaceId,
              tool: step.tool,
              arguments: step.arguments,
            },
            new Headers(),
          )

          if (!built.ok) return { ok: false, message: built.message }
          const next: Proposal = JSON.parse(built.proposal)

          const done = next.action
            ? await apply.applyAction(client, next)
            : await apply.applyProposal(
                client,
                next,
                randomUUID(),
                this.workspaceId,
              )

          return done.kind === 'applied'
            ? { ok: true, openHref: done.opened, note: done.note }
            : {
                ok: false,
                message: done.kind === 'failed' ? done.reason : 'signature',
              }
        },
        onUpdate: (_index, state) => {
          if (state.phase === 'failed') failures.push(state.message ?? '')

          if (state.openHref) opened = state.openHref
        },
      })

      result =
        outcome.status === 'done'
          ? { status: 'applied', opened }
          : { status: 'failed', reason: failures.join('; ') }
    } else {
      const done = proposal.action
        ? await apply.applyAction(client, proposal)
        : await apply.applyProposal(
            client,
            proposal,
            randomUUID(),
            this.workspaceId,
          )

      result =
        done.kind === 'applied'
          ? { status: 'applied', opened: done.opened }
          : done.kind === 'failed'
            ? { status: 'failed', reason: done.reason, opened: done.opened }
            : { status: 'needs_signature' }
    }

    await apply.rememberOutcome(client, card.callId, {
      status: result.status,
      title: proposal.title,
      reason: result.reason,
      opened: result.opened,
      at: new Date().toISOString(),
    })

    return result
  }

  /** A superuser query against the real database, for asserting what is stored. */
  async sql<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    return (await this.admin.query<T>(text, values)).rows
  }

  /** Calls an RPC as the signed-in person, the way the app does. */
  async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { createServerDataClient } =
      await import('#/lib/server-data-client.server')

    return createServerDataClient(await this.token()).rpc<T>(name, args)
  }

  /** A project, made the way the app makes one. */
  async createProject(title: string): Promise<{ id: string }> {
    return this.rpc<{ id: string }>('create_project', {
      p_title: title,
      p_client_id: null,
      p_modality: null,
      p_stage: null,
      p_lead_user_id: null,
      p_default_reviewer_user_id: null,
      p_agreement_reference: null,
      p_started_on: null,
    })
  }

  /** An experiment with an empty notebook, in a project. */
  async createExperiment(
    projectId: string,
    title: string,
  ): Promise<{ id: string; identifier: string }> {
    const made = await this.rpc<{ id: string; identifier: string }>(
      'create_record',
      { p_project_id: projectId, p_kind: 'experiment', p_title: title },
    )

    return made
  }

  /** What the notebook holds now: each block's text, in order. */
  async notebookText(recordId: string): Promise<string[]> {
    const rows = await this.sql<{ payload: unknown }>(
      `SELECT payload FROM api.blocks WHERE record_id = $1 ORDER BY "order"`,
      [recordId],
    )

    return rows.map((row) => JSON.stringify(row.payload))
  }

  async stop() {
    await this.model.stop()
    await this.admin.end()
  }
}

/** Reads an AI SDK UI message stream (server-sent events) into a turn. */
export async function readStream(body: string): Promise<Turn> {
  const turn: Turn = { text: '', steps: [], cards: [] }
  const inputs = new Map<string, { name: string; input: unknown }>()

  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6)

    if (data === '[DONE]') continue
    const part = JSON.parse(data) as Record<string, unknown>

    if (part.type === 'text-delta') turn.text += String(part.delta)
    else if (part.type === 'tool-input-available')
      inputs.set(String(part.toolCallId), {
        name: String(part.toolName),
        input: part.input,
      })
    else if (part.type === 'tool-output-available') {
      const id = String(part.toolCallId)
      const known = inputs.get(id)
      const output = part.output as {
        proposal?: Proposal
        refs?: string[]
      }

      turn.steps.push({
        id,
        name: known?.name ?? '',
        input: known?.input,
        ok: true,
        refs: output.refs,
      })

      if (output.proposal)
        turn.cards.push({
          callId: id,
          tool: output.proposal.tool,
          proposal: output.proposal,
        })
    } else if (part.type === 'tool-output-error') {
      const id = String(part.toolCallId)
      const known = inputs.get(id)

      turn.steps.push({
        id,
        name: known?.name ?? '',
        input: known?.input,
        ok: false,
        error: String(part.errorText),
      })
    } else if (part.type === 'error') turn.error = String(part.errorText)
  }

  return turn
}

export interface WorldOptions {
  /** Extra setup SQL, run as the database owner after the workspace exists. */
  seed?: (
    admin: Client,
    ids: { workspaceId: string; userId: string },
  ) => Promise<void>
}

/** Builds the workspace, the scripted model and the route. Call from `beforeAll`. */
export async function startWorld(options: WorldOptions = {}): Promise<World> {
  const model = await startMockModel()

  process.env.AI_PROVIDER_PROFILES = JSON.stringify({
    profiles: [
      {
        id: 'scripted',
        label: 'Scripted model',
        kind: 'local',
        baseUrl: model.baseUrl,
        model: 'sheetbase-assist-1',
        pricing: {
          inputMicrousdPerMillionTokens: 0,
          outputMicrousdPerMillionTokens: 0,
        },
      },
    ],
  })

  const admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()

  const workspaceId = randomUUID()
  const userId = `e2e-${randomUUID().slice(0, 8)}`

  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified")
     VALUES ($1,'Test Scientist',$2,true)`,
    [userId, `${userId}@assistant-e2e.test`],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,$2,'Assistant E2E')`,
    [workspaceId, `e2e-${workspaceId.slice(0, 8)}`],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role)
     VALUES ($1,$2,'owner')`,
    [workspaceId, userId],
  )
  await admin.query(
    `INSERT INTO api.workspace_settings(workspace_id,created_by_user_id)
     VALUES ($1,$2) ON CONFLICT (workspace_id) DO NOTHING`,
    [workspaceId, userId],
  )
  await admin.query(
    `UPDATE api.workspace_settings
        SET ai_enabled = true, ai_provider_profile = 'scripted',
            ai_model = 'sheetbase-assist-1',
            ai_max_tokens_per_call = 200000,
            ai_max_cost_microusd_per_call = 5000000
      WHERE workspace_id = $1`,
    [workspaceId],
  )

  await options.seed?.(admin, { workspaceId, userId })

  signedIn.userId = userId

  const [{ handleAssistantChat }, { mintPostgrestToken }] = await Promise.all([
    import('#/lib/assistant-chat.server'),
    import('#/lib/postgrest-token'),
  ])

  return new World({
    model,
    admin,
    workspaceId,
    userId,
    handle: handleAssistantChat,
    token: () =>
      mintPostgrestToken(process.env.PGRST_JWT_SECRET ?? '', {
        userId,
        workspaceId,
        sessionId: 'assistant-e2e-session',
      }),
  })
}
