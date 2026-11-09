/**
 * A feature: everything one area of the lab adds to the integration surfaces,
 * declared in its own folder (`src/features/<name>/`).
 *
 * Every shared list that features used to edit by hand (the operation
 * registry, the event catalogue, the API tables, the agent action areas, the
 * exemptions, the assistant's read tools, card dispatch and card words) reads
 * the generated index of these folders instead, so two features built at the
 * same time never touch the same file. See `docs/development/features.md`.
 *
 *   src/features/<name>/feature.ts           `export const feature = defineFeature({...})`
 *   src/features/<name>/assistant.ts         `export const assistant = defineAssistant<Action>()({...})`
 *   src/features/<name>/assistant.server.ts  `export const assistantServer = {...}`
 *   src/features/<name>/copy.ts              `export const copy = {...}`, read as `t('features.<name>.…')`
 *
 * `feature.ts` is loaded by every surface, including the browser and the
 * build scripts, so it holds declarations only: import operations, tables and
 * events, never application code with side effects.
 */
import type { DataClient } from '#/lib/data-client'
import type { EventCatalogueEntry } from '#/lib/event-catalogue'
import type { LabTable } from '#/lib/lab-api-surface'
import type { OperationDescriptor } from '#/lib/operations/descriptor'

/** Where a feature's actions are grouped on the agent permissions page. */
export interface FeatureAgentArea {
  /** The group's name, as the page shows it. */
  readonly area: string
  /** Action keys that belong to the group. */
  readonly match: RegExp
  /**
   * Test this feature before the built-in groups, for keys that would
   * otherwise fall into one of them (`decide_project_access_request` is about
   * people, not requests). Otherwise it is tried after them.
   */
  readonly beforeCore?: boolean
}

export interface Feature {
  /** The folder name. */
  readonly name: string
  /** Operations: API, SDK, MCP, pipeline actions, assistant names, events. */
  readonly operations?: readonly OperationDescriptor[]
  /** Catalogue events that are not declared on an operation. */
  readonly events?: readonly EventCatalogueEntry[]
  /** Human labels for this feature's events, by canonical name. */
  readonly eventLabels?: Readonly<Record<string, string>>
  /** Tables tokens may read (`lab:read`), as on `LAB_TABLES`. */
  readonly labTables?: Readonly<Record<string, LabTable>>
  /** `api` objects deliberately kept off tokens, with the reason. */
  readonly notExposed?: Readonly<Record<string, string>>
  readonly agentArea?: FeatureAgentArea
  /**
   * Action keys that look like a delete (and so would never be open to
   * agents) but that agents may do behind a confirmation, such as
   * `delete_workspace_group`. The database reads the same list from
   * `internal.agent_allowed_deletes`, which the feature's migration fills.
   */
  readonly agentMayDelete?: readonly string[]
  /** Read-only assistant tools this feature answers (see `assistant.server.ts`). */
  readonly assistantReadTools?: readonly string[]
}

/** Who sees an event: webhooks, the SSE stream and pipeline triggers. */
export const WEBHOOK_SSE_PIPELINE = Object.freeze({
  webhook: true,
  sse: true,
  pipeline: true,
} as const)

export function defineFeature<const TFeature extends Feature>(
  feature: TFeature,
): TFeature {
  return Object.freeze(feature)
}

/** What a card's action gave back: a page to open, and a line to show. */
export interface FeatureActionResult {
  openHref?: string
  note?: string
}

/**
 * The browser half of a feature's assistant cards (`assistant.ts`): which
 * actions are its own, how to run one when the person presses the button,
 * and the words on the button. `TAction` is the union of its card actions and
 * `TTool` the names of the tools that propose them.
 */
export interface FeatureAssistant<
  TAction extends { kind: string } = { kind: string },
  TTool extends string = string,
> {
  // Methods, not function properties: a feature's narrower action type must
  // still fit the shared list (method parameters are compared bivariantly).
  // eslint-disable-next-line @typescript-eslint/method-signature-style
  isAction(action: { kind: string }): action is TAction
  /** Runs as the person. Load the code lazily: it only runs on a press. */
  // eslint-disable-next-line @typescript-eslint/method-signature-style
  run(
    client: DataClient,
    action: TAction,
  ): Promise<FeatureActionResult | undefined | void>
  /**
   * The copy key that holds each action's `apply`, `applying` and `applied`
   * words, such as `features.notebook.cards.addComment`.
   */
  readonly cardWords: Readonly<Record<TAction['kind'], string>>
  /** Type only: the proposing tool names. */
  readonly __tool?: TTool
}

/** `defineAssistant<NotebookAction, NotebookProposeToolName>()({...})`. */
export function defineAssistant<
  TAction extends { kind: string },
  TTool extends string = string,
>() {
  return (assistant: FeatureAssistant<TAction, TTool>) =>
    Object.freeze(assistant)
}

type ActionOf<T> = T extends FeatureAssistant<infer A, string> ? A : never
type ToolOf<T> =
  T extends FeatureAssistant<{ kind: string }, infer N> ? N : never

/** The card actions of every feature in `list`. */
export type FeatureActions<TList extends readonly unknown[]> = ActionOf<
  TList[number]
>
/** The proposing tool names of every feature in `list`. */
export type FeatureProposeTools<TList extends readonly unknown[]> = ToolOf<
  TList[number]
>
