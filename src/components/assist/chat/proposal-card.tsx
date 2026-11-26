import { useState } from 'react'
import type { CardOutcome } from '#/lib/assistant-card-outcomes'
import { cardOutcomeFor } from '#/lib/assistant-card-outcomes'
import { Link, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { FEATURE_ASSISTANTS } from '#/features/assistant.gen'
import type { FeatureActions } from '#/features/define'
import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import {
  applyAction,
  applyProposal,
  rememberOutcome,
} from '#/lib/assistant-apply'
import type { ApplyOutcome } from '#/lib/assistant-apply'
import { createDataClient } from '#/lib/data-client'
import type {
  AssistantProposal,
  ProposalChange,
} from '#/lib/assistant-proposals'
import { beginChangeSet, finishChangeSet } from '#/features/ai-undo/client'
import { isUndoableTool } from '#/features/ai-undo/undo'
import type { AssistantActionKind } from '#/lib/assistant-booking'
import { reportActionFailure } from '#/lib/assistant-failure-feed'
import { isPlanAction } from '#/features/plans/plan'
import type { PlanStepResult } from '#/features/plans/plan'
import { PlanCard } from './plan-card'
import { UndoPanel } from './undo-panel'

/**
 * A change the assistant suggests, as a card. Nothing has been written. Apply
 * runs the ordinary propose, approve and execute steps as the signed-in person,
 * so the version check and the audit trail are the same as any other change.
 * An everyday action, such as booking an instrument, instead runs the same RPC
 * the page would, as the person, when they press its button.
 */

type CardState =
  | { phase: 'idle' }
  | { phase: 'applying' }
  | { phase: 'applied' }
  | { phase: 'dismissed' }
  | { phase: 'signature' }
  | { phase: 'failed'; reason: string }

/** A card decided in an earlier visit, from the outcome saved with its chat. */
function savedPhase(callId: string): CardState {
  const saved = cardOutcomeFor(callId)

  if (saved?.status === 'applied') return { phase: 'applied' }

  if (saved?.status === 'dismissed') return { phase: 'dismissed' }

  if (saved?.status === 'failed')
    return { phase: 'failed', reason: saved.reason ?? '' }

  return { phase: 'idle' }
}

/** Tells the assistant what became of the card, and which record it made. */
async function noteOutcome(
  callId: string,
  title: string,
  state: CardState,
  opened?: string,
): Promise<void> {
  const at = new Date().toISOString()

  const status =
    state.phase === 'applied'
      ? 'applied'
      : state.phase === 'dismissed'
        ? 'dismissed'
        : state.phase === 'failed'
          ? 'failed'
          : 'needs_signature'

  const base: CardOutcome = { status, title, at }

  if (state.phase === 'failed') base.reason = state.reason

  if (opened) base.opened = opened

  await rememberOutcome(createDataClient(), callId, base)
}

/** Kept outside the component so a re-render or reopened panel remembers it. */
const decided = new Map<string, CardState>()

/** The set of changes each applied card made, so its Undo survives a re-render. */
const undoSets = new Map<string, string>()

/** Which copy keys an everyday action uses for its button and done words. */
const ACTION_COPY = {
  'booking.create': 'book',
  'booking.move': 'move',
  'booking.cancel': 'cancel',
  'reagent.order': 'orderReagent',
  'reagent.receive': 'receiveReagent',
  'reagent.place': 'placeReagent',
  'instrument.rate': 'instrumentRate',
  'samples.log': 'logSamples',
  'sample.use': 'useSample',
  'sample.move': 'moveSamples',
  'sample.split': 'splitSample',
  'record.create': 'reportIncident',
  'request.send': 'sendRequest',
  'sample.advance': 'advanceSample',
  'instrument.service': 'instrumentService',
  'storage.reading': 'storageReading',
  'experiment.start': 'startExperiment',
  'record.assign': 'assign',
  'record.comment': 'ask',
  'booking.repeat': 'repeat',
  'timer.start': 'timer',
  'step.done': 'finishStep',
  'step.result': 'stepResult',
  'series.add': 'addToSeries',
  'series.remove': 'removeFromSeries',
  'part.add': 'addPart',
  'part.update': 'updatePart',
  'part.done': 'finishPart',
  'gate.go_on': 'goOnGate',
  'part.signoff_request': 'askPartSignoff',
  'shipment.create': 'sendShipment',
  'shipment.receive': 'receiveShipment',
  'project.create': 'createProject',
  'follow.set': 'follow',
  'absence.set': 'setAway',
  'absence.cancel': 'cancelAway',
  'handover.run': 'handOver',
  'group_role.set': 'mapGroup',
  'group_role.remove': 'unmapGroup',
  'scim_token.revoke': 'revokeSync',
  'timestamps.set': 'setTimestamps',
  'timestamps.retry': 'retryTimestamp',
  'validation.run': 'runValidation',
  'pipeline.reproduce': 'reproduceRun',
  'contract.check': 'checkContract',
  'contract.rule_add': 'addContractRule',
  'open_tables.set': 'setOpenTables',
  'publication.request': 'requestPublication',
  'notifications.read': 'markRead',
  'reagent.ordered': 'markOrdered',
  'reagent.cancel': 'cancelOrder',
  'shipment.cancel': 'cancelShipment',
  'sample.reserve': 'reserveSample',
  'sample.quarantine': 'quarantineSample',
  'sample.dispose': 'disposeSample',
  'sample.receive': 'receiveSample',
  'sample.archive': 'archiveSample',
  'sample.reservation_cancel': 'cancelReservation',
  'storage.place': 'placeSample',
  'storage.add_location': 'addLocation',
  'instrument.log': 'logVisit',
  'stocktake.start': 'startStocktake',
  'stocktake.complete': 'finishStocktake',
  'hold.create': 'createHold',
  'hold.release': 'releaseHold',
  'retention.set': 'setRetention',
  'retention.apply': 'applyRetention',
  'registry.add': 'addRegistryEntry',
  'compound.lot': 'addCompoundLot',
  'workflow.enrol': 'enrolWorkflow',
  'workflow.leave': 'leaveWorkflow',
  'limits.set': 'setLimits',
  'booking_rules.set': 'setBookingRules',
  'timer.end': 'endTimer',
  'recurring.pause': 'pauseRepeat',
  'recurring.end': 'endRepeat',
  'sample.pool': 'poolSamples',
  'solution.prepare': 'prepareSolution',
  'search.save': 'saveSearch',
  'pin.set': 'pin',
  'logo.set': 'setLogo',
  'logo.remove': 'removeLogo',
  'watcher.finding': 'setFinding',
  'watcher.set': 'setWatcher',
  'plate.analyse': 'analysePlate',
  'worklist.create': 'createWorklist',
  'study.task_add': 'addStudyTask',
  'study.task_update': 'updateStudyTask',
  'study.deliverable_add': 'addStudyDeliverable',
  'report.generate': 'generateReport',
  'plate_design.archive': 'archivePlateDesign',
  'study.task_delete': 'deleteStudyTask',
  'analysis_view.delete': 'deleteAnalysisView',
  'analysis_definition.delete': 'deleteAnalysisDefinition',
  'instrument.add': 'addInstrument',
  'instrument.retire': 'retireInstrument',
  'instrument.calibrate': 'calibrateInstrument',
  'instrument.qualify': 'qualifyPerson',
  'run.create': 'recordRun',
  'run.update': 'updateRun',
  'connector.set': 'setConnector',
  'qc.set_baseline': 'setQcBaseline',
  'qc.acknowledge': 'acknowledgeQc',
  'robot.send': 'sendToRobot',
  'schedule.plan': 'planSchedule',
  'schedule.accept': 'acceptSchedule',
  'plan.apply': 'applyPlan',
  'plugin.run': 'runExtension',
} as const satisfies Record<
  Exclude<
    AssistantActionKind,
    FeatureActions<typeof FEATURE_ASSISTANTS>['kind']
  >,
  string
>

/** The copy word of each everyday action, by kind. */
const ACTION_WORDS: ReadonlyMap<string, string> = new Map(
  Object.entries(ACTION_COPY),
)

/** The copy key of each feature card's words (`src/features/<name>/assistant.ts`). */
const FEATURE_CARD_WORDS: Readonly<Record<string, string>> = Object.assign(
  {},
  ...FEATURE_ASSISTANTS.map((feature) => feature.cardWords),
)

/** Button and done words for an everyday action: "Book", "Booked". */
function actionWords(kind: AssistantActionKind | undefined) {
  const prefix = kind ? cardWordsKey(kind) : null

  if (prefix === null) {
    return {
      label: t('notebook.assistantPanel.proposal.label'),
      apply: t('notebook.assistantPanel.proposal.apply'),
      applying: t('notebook.assistantPanel.proposal.applying'),
      applied: t('notebook.assistantPanel.proposal.applied'),
    }
  }

  return {
    label:
      kind?.startsWith('booking.') && kind !== 'booking.repeat'
        ? t('notebook.assistantPanel.proposal.bookingLabel')
        : t('notebook.assistantPanel.proposal.actionLabel'),
    apply: cardWord(`${prefix}.apply`),
    applying: cardWord(`${prefix}.applying`),
    applied: cardWord(`${prefix}.applied`),
  }
}

/**
 * A card's button word, by a key put together at run time; the copy tests
 * check that every card's words are in the catalogue.
 */
// SAFETY: `t` resolves any catalogue path at run time and falls back to the key when one is absent; the keys built here are the groups this card declares.
const cardWord = t as (key: string) => string

/** Where the card's words are in the copy catalogue. */
function cardWordsKey(kind: AssistantActionKind): string {
  const own = FEATURE_CARD_WORDS[kind]

  if (own) return own

  return `notebook.assistantPanel.proposal.${ACTION_WORDS.get(kind)}`
}

export function ProposalCard({
  callId,
  workspaceId,
  proposal,
}: {
  callId: string
  workspaceId: string
  proposal: AssistantProposal
}) {
  const action = proposal.action

  if (action && isPlanAction(action)) {
    return (
      <PlanCard
        callId={callId}
        proposal={proposal}
        action={action}
        applyBuilt={(built) => applyPlanStep(built, workspaceId)}
      />
    )
  }

  return (
    <SingleProposalCard
      callId={callId}
      workspaceId={workspaceId}
      proposal={proposal}
    />
  )
}

/** Applies one step of a plan the way a card of its own would be applied. */
async function applyPlanStep(
  built: AssistantProposal,
  workspaceId: string,
): Promise<PlanStepResult> {
  const client = createDataClient()

  const outcome = built.action
    ? await applyAction(client, built)
    : await applyProposal(client, built, crypto.randomUUID(), workspaceId)

  if (outcome.kind === 'applied') {
    return { ok: true, openHref: outcome.opened, note: outcome.note }
  }

  return {
    ok: false,
    message:
      outcome.kind === 'signature'
        ? t('features.plans.plan.needsSignature')
        : outcome.reason,
  }
}

function SingleProposalCard({
  callId,
  workspaceId,
  proposal,
}: {
  callId: string
  workspaceId: string
  proposal: AssistantProposal
}) {
  const [state, setStateRaw] = useState<CardState>(
    () => decided.get(callId) ?? savedPhase(callId),
  )

  // One key per card, so a double press repeats the same request instead of
  // making a second change. Call ids from a provider are not unique across chats.
  const [requestId] = useState(() => crypto.randomUUID())
  // Where a pipeline the card just made lives, when the card makes one.
  const [opened, setOpened] = useState<string | null>(null)
  // A one-time link the card made, such as a new invitation's.
  const [note, setNote] = useState<string | null>(null)

  // The changes this card made, so they can be undone.
  const [undoSetId, setUndoSetId] = useState<string | null>(
    () => undoSets.get(callId) ?? null,
  )

  const queryClient = useQueryClient()
  const router = useRouter()

  function setState(next: CardState, madeAt?: string) {
    if (next.phase !== 'applying') decided.set(callId, next)
    setStateRaw(next)

    if (next.phase !== 'applying' && next.phase !== 'idle')
      void noteOutcome(callId, proposal.title, next, madeAt)
  }

  async function apply() {
    setState({ phase: 'applying' })

    const client = createDataClient()
    let outcome: ApplyOutcome

    if (proposal.action) {
      const recording = isUndoableTool(proposal.tool)
      let openSet: string | null = null

      // Only what the audit trail carries in full can be undone, so only those
      // cards are recorded. The card runs the same whether or not this works.
      if (recording) {
        try {
          openSet = await beginChangeSet(client, {
            title: proposal.title,
            kind: 'card',
          })
        } catch {
          openSet = null
        }
      }

      outcome = await applyAction(client, proposal)

      if (openSet) {
        try {
          const kept = await finishChangeSet(client, openSet, [])

          if (kept) {
            undoSets.set(callId, kept.id)
            setUndoSetId(kept.id)
          }
        } catch {
          // Nothing to undo when the set could not be closed.
        }
      }
    } else {
      outcome = await applyProposal(client, proposal, requestId, workspaceId)
    }

    if (outcome.opened) setOpened(outcome.opened)

    if (outcome.kind === 'signature') {
      setState({ phase: 'signature' })

      return
    }

    if (outcome.kind === 'failed') {
      setState({ phase: 'failed', reason: outcome.reason })
      reportActionFailure({
        id: callId,
        title: proposal.title,
        reason: outcome.reason,
      })

      return
    }

    if (outcome.note) setNote(outcome.note)
    setState({ phase: 'applied' }, outcome.opened)
    void queryClient.invalidateQueries()
    void router.invalidate()
  }

  const words = actionWords(proposal.action?.kind)
  const href = opened ?? proposal.deepLink

  return (
    <section
      data-testid="assistant-proposal"
      data-state={state.phase}
      aria-label={words.label}
      className="relative flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
    >
      <header className="flex items-start gap-2 pr-16">
        <span className="mt-0.5 text-fg-muted">
          <Icon name="spark" size={14} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-label text-fg-muted">
            {words.label} · {proposal.target}
          </span>
          <span className="text-body font-medium text-fg">
            {proposal.title}
          </span>
        </div>
      </header>
      <p className="m-0 text-body text-fg-muted">{proposal.summary}</p>
      <ProposalChanges changes={proposal.changes} />
      <ProposalStatus state={state} note={note} />
      <ProposalActions
        state={state}
        words={words}
        href={href}
        opened={opened}
        onApply={() => void apply()}
        onDismiss={() => setState({ phase: 'dismissed' })}
      />
      {undoSetId && (state.phase === 'applied' || state.phase === 'failed') ? (
        <UndoPanel key={undoSetId} setId={undoSetId} corner />
      ) : null}
    </section>
  )
}

/** The change list a card shows: what would change, before and after. */
function ProposalChanges({ changes }: { changes: ProposalChange[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {changes.map((change) => (
        <li
          key={`${change.label}-${change.after}`}
          className="flex flex-col gap-1 rounded-lg bg-surface-muted px-2.5 py-2 text-label"
        >
          <span className="font-medium text-fg">{change.label}</span>
          {change.before !== null ? (
            <span className="whitespace-pre-line text-fg-muted line-through decoration-fg-faint">
              {change.before}
            </span>
          ) : null}
          <span className="whitespace-pre-line text-fg">{change.after}</span>
        </li>
      ))}
    </ul>
  )
}

/** What the card says once it is applied, failed or waiting on a signature. */
function ProposalStatus({
  state,
  note,
}: {
  state: CardState
  note: string | null
}) {
  if (state.phase === 'failed') {
    return (
      <p className="m-0 text-label text-danger-text" role="alert">
        {state.reason}
      </p>
    )
  }

  if (state.phase === 'applied' && note) {
    return (
      <p className="m-0 break-all text-label text-fg-muted">
        {t('notebook.assistantPanel.proposal.linkNote')}{' '}
        <span className="select-all font-medium text-fg">{note}</span>
      </p>
    )
  }

  if (state.phase === 'signature') {
    return (
      <p className="m-0 text-label text-fg-muted">
        {t('notebook.assistantPanel.proposal.needsSignature')}{' '}
        <Link
          to="/pipelines/agents"
          className="font-medium text-fg underline underline-offset-2"
        >
          {t('notebook.assistantPanel.proposal.reviewProposals')}
        </Link>
      </p>
    )
  }

  return null
}

/** The card's buttons, its done state, and the link to what it made. */
function ProposalActions({
  state,
  words,
  href,
  opened,
  onApply,
  onDismiss,
}: {
  state: CardState
  words: ReturnType<typeof actionWords>
  href: string | null
  opened: string | null
  onApply: () => void
  onDismiss: () => void
}) {
  const applying = state.phase === 'applying'

  return (
    <div className="flex items-center gap-2">
      {state.phase === 'applied' || state.phase === 'dismissed' ? (
        <span className="inline-flex items-center gap-1 text-label text-fg-muted">
          <Icon name={state.phase === 'applied' ? 'check' : 'x'} size={12} />
          {state.phase === 'applied'
            ? words.applied
            : t('notebook.assistantPanel.proposal.dismissed')}
        </span>
      ) : state.phase === 'signature' ? null : (
        <>
          <Button
            size="sm"
            variant="primary"
            disabled={applying}
            onClick={onApply}
          >
            {applying ? words.applying : words.apply}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            disabled={applying}
            onClick={onDismiss}
          >
            {t('notebook.assistantPanel.proposal.dismiss')}
          </Button>
        </>
      )}
      <span className="flex-1" />
      {href &&
      (state.phase === 'applied' || (state.phase === 'failed' && opened)) ? (
        <a
          href={href}
          className="text-label font-medium text-fg underline underline-offset-2"
        >
          {t('notebook.assistantPanel.proposal.open')}
        </a>
      ) : null}
    </div>
  )
}
