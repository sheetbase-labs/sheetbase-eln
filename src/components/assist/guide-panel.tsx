/**
 * ASSIST-03 — Guide panel.
 *
 * Step-aware guidance display: step list with done/current/blocked states,
 * missing-prerequisite explanations (ASSIST-01 grounded explanations where
 * they fit), and next-action buttons that navigate to or invoke the existing
 * surface/accept path. The panel never mutates anything itself — accept
 * actions call the host's `onAccept` (which executes the ordinary canonical
 * operation) and navigation is plain links. Marked as assistance throughout.
 */
import type { GuideAcceptKey, GuidedWorkflow } from '#/lib/assist-guide'
import { Button } from '#/components/ui'

import { ExplainPanel } from './explain-panel'

const STATE_LABEL: Record<string, string> = {
  done: 'Done',
  current: 'Current',
  blocked: 'Blocked',
}

export function GuidePanel({
  workflow,
  accepting,
  onAccept,
}: {
  workflow: GuidedWorkflow
  accepting?: boolean
  onAccept: (key: GuideAcceptKey) => void
}) {
  return (
    <section
      aria-label={`Guide: ${workflow.title}`}
      className="space-y-2 rounded-md border bg-muted/20 p-2 text-xs"
    >
      <p className="rounded border border-dashed p-1.5 text-muted-foreground">
        {workflow.marking.badge}
      </p>
      <h4 className="font-semibold">{workflow.title}</h4>
      <p>{workflow.description}</p>
      {workflow.complete ? (
        <p className="font-medium">Workflow complete — every step is done.</p>
      ) : null}
      <ol className="space-y-2">
        {workflow.steps.map((step, index) => (
          <li
            key={step.id}
            aria-label={`Step ${index + 1}: ${step.title} (${STATE_LABEL[step.state]})`}
            className="space-y-1 rounded border p-2"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">
                {index + 1}. {step.title}
              </p>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                {STATE_LABEL[step.state]}
              </span>
            </div>
            <p className="text-muted-foreground">{step.detail}</p>
            {step.objects.map((object) => (
              <p key={`${object.kind}:${object.id}`} className="text-muted-foreground">
                <span className="font-mono">
                  [{object.kind} {object.id}]
                </span>{' '}
                <span className="font-mono">{object.deepLink}</span>
              </p>
            ))}
            {step.blockedReason ? <p>{step.blockedReason}</p> : null}
            {step.explanation ? <ExplainPanel explanation={step.explanation} /> : null}
            {step.nextActions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {step.nextActions.map((action) => {
                  if (action.target.kind === 'navigate') {
                    return (
                      <a
                        key={action.label}
                        href={action.target.href}
                        title={action.target.hint}
                        className="inline-flex h-7 items-center justify-center rounded-md border px-2.5 font-medium no-underline hover:bg-muted"
                      >
                        {action.label}
                      </a>
                    )
                  }
                  const acceptKey = action.target.acceptKey
                  return (
                    <Button
                      key={action.label}
                      size="sm"
                      variant="outline"
                      title={action.target.hint}
                      disabled={accepting}
                      onClick={() => onAccept(acceptKey)}
                    >
                      {action.label}
                    </Button>
                  )
                })}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="text-muted-foreground">{workflow.marking.note}</p>
    </section>
  )
}
