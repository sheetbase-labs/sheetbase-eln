import { useRef, useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { DataClientError, createDataClient } from '#/lib/data-client'
import {
  decideAgentOperation,
  executeAgentOperation,
  proposeAgentOperation,
} from '#/lib/agent-operations'
import type { AgentOperation } from '#/lib/agent-operations'
import type { AssistantProposal } from '#/lib/assistant-proposals'
import { runAssistantAction } from '#/lib/assistant-booking'
import type { AssistantActionKind } from '#/lib/assistant-booking'
import { describeActionError } from '#/lib/assistant-bench'
import { describeCalendarError } from '#/lib/calendar'

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

/** Kept outside the component so a re-render or reopened panel remembers it. */
const decided = new Map<string, CardState>()

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
  'instrument.log': 'logVisit',
  'stocktake.start': 'startStocktake',
  'stocktake.complete': 'finishStocktake',
  'hold.create': 'createHold',
  'hold.release': 'releaseHold',
  'retention.set': 'setRetention',
  'retention.apply': 'applyRetention',
  'registry.add': 'addRegistryEntry',
  'compound.register': 'registerCompound',
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
  'qc.set_baseline': 'setQcBaseline',
  'qc.acknowledge': 'acknowledgeQc',
  'robot.send': 'sendToRobot',
  'schedule.plan': 'planSchedule',
  'schedule.accept': 'acceptSchedule',
  'plan.apply': 'applyPlan',
} as const satisfies Record<AssistantActionKind, string>

/** Button and done words for an everyday action: "Book", "Booked". */
function actionWords(kind: AssistantActionKind | undefined) {
  const key = kind ? ACTION_COPY[kind] : null
  if (key === null) {
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
    apply: t(`notebook.assistantPanel.proposal.${key}.apply`),
    applying: t(`notebook.assistantPanel.proposal.${key}.applying`),
    applied: t(`notebook.assistantPanel.proposal.${key}.applied`),
  }
}

function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return /stale|revision|version|conflict/i.test(message)
    ? t('notebook.assistantPanel.proposal.stale')
    : t('notebook.assistantPanel.proposal.failed', {
        reason: message || t('common.errors.generic'),
      })
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
  const [state, setStateRaw] = useState<CardState>(
    decided.get(callId) ?? { phase: 'idle' },
  )
  // One key per card, so a double press repeats the same request instead of
  // making a second change. Call ids from a provider are not unique across chats.
  const requestId = useRef(crypto.randomUUID()).current
  // Where a pipeline the card just made lives, when the card makes one.
  const [opened, setOpened] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const router = useRouter()
  function setState(next: CardState) {
    if (next.phase !== 'applying') decided.set(callId, next)
    setStateRaw(next)
  }

  async function apply() {
    setState({ phase: 'applying' })
    if (proposal.action) {
      try {
        const result = await runAssistantAction(
          createDataClient(),
          proposal.action,
        )
        if (result?.openHref) setOpened(result.openHref)
        setState({ phase: 'applied' })
        void queryClient.invalidateQueries()
        void router.invalidate()
      } catch (error) {
        setState({
          phase: 'failed',
          reason: t('notebook.assistantPanel.proposal.failed', {
            reason:
              error instanceof DataClientError
                ? describeCalendarError(error)
                : describeActionError(error),
          }),
        })
      }
      return
    }
    const operation = proposal.operation
    if (!operation) return
    try {
      const client = createDataClient()
      // Runs one operation through propose, approve and execute. `null` means
      // it is waiting on a signature, which the card hands over to the
      // proposals page.
      async function run(operation: AgentOperation, key: string) {
        let row = await proposeAgentOperation(client, {
          workspaceId,
          title: proposal.title,
          summary: proposal.summary,
          operation,
          provenance: {
            agentId: 'assistant',
            agentName: 'Assistant',
            tool: { name: proposal.tool },
            model: { provider: 'sheetbase', name: 'assistant' },
            invocationId: requestId,
          },
          idempotencyKey: key,
        })
        if (row.status === 'pending') {
          if (row.signature_required) return null
          row = await decideAgentOperation(client, {
            proposalId: row.id,
            expectedRevision: Number(row.revision),
            decision: 'approve',
          })
        }
        if (row.status === 'approved') {
          row = await executeAgentOperation(client, {
            proposalId: row.id,
            expectedRevision: Number(row.revision),
          })
        }
        return row
      }

      const first = await run(operation, `assistant-${requestId}`)
      if (first === null) {
        setState({ phase: 'signature' })
        return
      }
      if (first.status === 'failed') {
        setState({
          phase: 'failed',
          reason: failureReason(new Error(first.error_message ?? '')),
        })
        return
      }
      if (proposal.followUp) {
        // The first change made something (a new pipeline); the second fills
        // it in, pinned to the revision the first one returned.
        const made = first.result as {
          id?: string
          revision?: number | string
        } | null
        if (!made?.id) throw new Error(t('common.errors.generic'))
        setOpened(`/pipelines/${made.id}`)
        const second = await run(
          {
            kind: proposal.followUp.kind,
            workspaceId: proposal.followUp.workspaceId,
            definitionId: made.id,
            expectedDefinitionRevision: Number(made.revision),
            configuration: proposal.followUp.configuration,
          },
          `assistant-${requestId}-draft`,
        )
        if (second === null) {
          setState({ phase: 'signature' })
          return
        }
        if (second.status === 'failed') {
          setState({
            phase: 'failed',
            reason: failureReason(new Error(second.error_message ?? '')),
          })
          return
        }
      }
      setState({ phase: 'applied' })
      void queryClient.invalidateQueries()
      void router.invalidate()
    } catch (error) {
      setState({ phase: 'failed', reason: failureReason(error) })
    }
  }

  const words = actionWords(proposal.action?.kind)
  const href = opened ?? proposal.deepLink
  const done = state.phase === 'applied' || state.phase === 'dismissed'
  return (
    <section
      data-testid="assistant-proposal"
      data-state={state.phase}
      aria-label={words.label}
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
    >
      <header className="flex items-start gap-2">
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
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {proposal.changes.map((change, index) => (
          <li
            key={`${change.label}-${index}`}
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
      {state.phase === 'failed' ? (
        <p className="m-0 text-label text-danger-text" role="alert">
          {state.reason}
        </p>
      ) : null}
      {state.phase === 'signature' ? (
        <p className="m-0 text-label text-fg-muted">
          {t('notebook.assistantPanel.proposal.needsSignature')}{' '}
          <Link
            to="/pipelines/agents"
            className="font-medium text-fg underline underline-offset-2"
          >
            {t('notebook.assistantPanel.proposal.reviewProposals')}
          </Link>
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        {done ? (
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
              disabled={state.phase === 'applying'}
              onClick={() => void apply()}
            >
              {state.phase === 'applying' ? words.applying : words.apply}
            </Button>
            <Button
              size="sm"
              variant="quiet"
              disabled={state.phase === 'applying'}
              onClick={() => setState({ phase: 'dismissed' })}
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
    </section>
  )
}
