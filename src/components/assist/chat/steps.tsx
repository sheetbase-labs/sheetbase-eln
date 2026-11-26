import { z } from 'zod'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Spinner } from '#/components/ui/spinner'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { LinkedText } from '#/components/ui/linked-text'
import {
  callLine,
  foundLine,
  groupSteps,
  itemLine,
  stepWords,
} from '#/lib/assistant-steps'
import type { StepCall, StepItem, StepState } from '#/lib/assistant-steps'

/** What a finished call sent back to the browser besides "it worked". */
const outputSchema = z.looseObject({ refs: z.array(z.string()).optional() })

/** The step list's view of one tool part of a streamed message. */
export function stepCallOf(part: {
  toolName: string
  input?: unknown
  state: string
  output?: unknown
  errorText?: string
}): StepCall {
  const state: StepState =
    part.state === 'output-error'
      ? 'failed'
      : part.state === 'output-available'
        ? 'done'
        : 'running'

  return {
    toolName: part.toolName,
    input: part.input,
    state,
    refs: outputSchema.safeParse(part.output).data?.refs,
    error: part.errorText,
  }
}

function StateIcon({ state }: { state: StepState }) {
  return state === 'running' ? (
    <Spinner size={12} />
  ) : state === 'failed' ? (
    <Icon name="warn" size={12} />
  ) : (
    <Icon name="check" size={12} />
  )
}

/** The records a finished lookup named, each a link with peek. */
function Found({ call }: { call: StepCall }) {
  const line =
    call.state === 'done' && stepWords(call).lists
      ? foundLine(call.refs ?? [])
      : null

  return line ? (
    <span className="text-fg-muted">
      {' · '}
      <LinkedText text={line} />
    </span>
  ) : null
}

function StepRow({ call }: { call: StepCall }) {
  return (
    <div
      className="flex items-start gap-1.5 text-label text-fg-muted"
      data-testid="assistant-lookup"
      data-state={call.state}
    >
      <span className="mt-[3px] shrink-0">
        <StateIcon state={call.state} />
      </span>
      <span className="min-w-0 break-words">
        <LinkedText text={callLine(call)} />
        <Found call={call} />
      </span>
    </div>
  )
}

function StepGroup({ item }: { item: StepItem }) {
  return (
    <Collapsible>
      <div
        className="flex items-start gap-1.5 text-label text-fg-muted"
        data-testid="assistant-lookup"
        data-state="done"
        data-merged={item.calls.length}
      >
        <span className="mt-[3px] shrink-0">
          <StateIcon state="done" />
        </span>
        <span className="min-w-0 break-words">
          <LinkedText text={itemLine(item)} />
        </span>
        <CollapsibleTrigger className="mt-px shrink-0 text-fg-muted">
          <span className="sr-only">
            {t('notebook.assistantPanel.step.showEach')}
          </span>
        </CollapsibleTrigger>
      </div>
      <CollapsiblePanel>
        <div
          className="mt-1 ml-[18px] flex flex-col gap-1 border-l border-border-subtle pl-2.5"
          data-testid="assistant-lookup-each"
        >
          {item.calls.map((call, index) => (
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- The calls of one group are fixed once finished and carry no id of their own here.
            <StepRow key={index} call={call} />
          ))}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  )
}

/** A run of the assistant's lookups, with alike ones said as one line. */
export function StepList({ calls }: { calls: readonly StepCall[] }) {
  return (
    <div className="flex flex-col gap-1">
      {groupSteps(calls).map((item, index) =>
        item.calls.length > 1 ? (
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- Items are rebuilt from an append-only list of calls, so an item keeps its position.
          <StepGroup key={index} item={item} />
        ) : item.calls[0] ? (
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- As above.
          <StepRow key={index} call={item.calls[0]} />
        ) : null,
      )}
    </div>
  )
}
