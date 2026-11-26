import { z } from 'zod'

import type { ProviderToolDef } from './ai-providers/types'
import { invalid, toolDef } from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { ProposalChange } from './assistant-proposals'
import type { RpcArgument, RpcCardAction } from './assistant-call-cards'

/**
 * The server half of `assistant-call-cards.ts`. A feature lists its cards as
 * specs: the tool, what it is for, the arguments the model gives, and a
 * builder that finds what was named under the person's own access and says
 * what will change. Nothing is written here.
 */

export interface CardBuilt {
  /** What the card is about: "Plate reader (INS-0004)". */
  target: string
  changes: ProposalChange[]
  params: { readonly [name: string]: RpcArgument }
  openHref: string | null
}

/** The two lines every card opens with, which the model writes. */
interface CardWords {
  title: string
  summary: string
}

export interface CardSpec<
  TTool extends string = string,
  TKind extends string = string,
> {
  tool: TTool
  kind: TKind
  /** What the model reads: when to use the tool. */
  description: string
  schema: z.ZodType
  /** Reads the model's arguments, finds what they name, and says what changes. A string is the reason it cannot. */
  build: (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the spec's own schema before any field is read.
    args: unknown,
    context: LabToolContext,
  ) => Promise<(CardBuilt & CardWords) | string>
}

/** What a feature writes for one card: its schema, and a builder that gets the parsed arguments. */
interface CardDraft<
  TTool extends string,
  TKind extends string,
  TSchema extends z.ZodType<CardWords>,
> {
  tool: TTool
  kind: TKind
  description: string
  schema: TSchema
  build: (
    input: z.infer<TSchema>,
    context: LabToolContext,
  ) => Promise<CardBuilt | string>
}

/** Ties each builder to its own schema: the arguments are parsed before it runs. */
export function cardSpec<
  TTool extends string,
  TKind extends string,
  TSchema extends z.ZodType<CardWords>,
>(draft: CardDraft<TTool, TKind, TSchema>): CardSpec<TTool, TKind> {
  return {
    tool: draft.tool,
    kind: draft.kind,
    description: draft.description,
    schema: draft.schema,
    build: async (args, context) => {
      const parsed = draft.schema.safeParse(args)

      if (!parsed.success) return invalid(parsed.error)
      const built = await draft.build(parsed.data, context)

      if (isMessage(built)) return built

      return {
        ...built,
        title: parsed.data.title,
        summary: parsed.data.summary,
      }
    },
  }
}

/** A builder answers with a card, or with the reason it cannot make one. */
const isMessage = (value: CardBuilt | string): value is string =>
  z.string().safeParse(value).success

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export type CardOutcome<TTool extends string, TKind extends string> =
  | {
      ok: true
      proposal: {
        tool: TTool
        title: string
        summary: string
        target: string
        deepLink: string | null
        changes: ProposalChange[]
        action: RpcCardAction<TKind>
      }
    }
  | { ok: false; message: string }

export function cardDefs(
  specs: readonly CardSpec<string, string>[],
): ProviderToolDef[] {
  return specs.map((spec) =>
    toolDef(spec.tool, `${spec.description} ${NOTE}`, spec.schema),
  )
}

export async function buildCard<TTool extends string, TKind extends string>(
  specs: readonly CardSpec<TTool, TKind>[],
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; the spec parses them with its own schema before reading a field.
  args: unknown,
  context: LabToolContext,
): Promise<CardOutcome<TTool, TKind>> {
  const spec = specs.find((candidate) => candidate.tool === name)

  if (!spec) return { ok: false, message: 'Unknown tool.' }
  const built = await spec.build(args, context)

  if (isMessage(built)) return { ok: false, message: built }

  return {
    ok: true,
    proposal: {
      tool: spec.tool,
      title: built.title,
      summary: built.summary,
      target: built.target,
      deepLink: built.openHref,
      changes: built.changes,
      action: {
        kind: spec.kind,
        params: built.params,
        openHref: built.openHref,
      },
    },
  }
}
