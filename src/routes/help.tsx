import { createFileRoute, Link, redirect } from '@tanstack/react-router'

import { useShell } from '#/components/shell'
import { Button } from '#/components/ui'
import { requestShortcutsDialog } from '#/lib/shortcuts-dialog'

export const Route = createFileRoute('/help')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: HelpRoute,
})

/**
 * WORK-02.4 — "How records, reviews and signatures work" (HelpRecords). Static
 * reference page; the copy and the lifecycle diagram are the design's.
 */
function HelpRoute() {
  const { context } = Route.useRouteContext()

  useShell({
    context: {
      workspace: context.workspace ? { name: context.workspace.name } : null,
      user: { name: context.user.name, email: context.user.email },
    },
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Help' }],
    title: 'How records, reviews and signatures work',
  })

  return (
    <article className="flex max-w-[1120px] flex-col gap-4">
      <p className="text-prose text-foreground">
        Every experiment, dataset and protocol moves through the same states.
        What you can change depends on the state, and every change is written to
        History with who, when, the old value and the reason.
      </p>
      <RecordLifecycleDiagram />
      <h2 className="text-doc-heading text-foreground">Signatures</h2>
      <p className="text-prose text-foreground">
        A signature is your password entered again at the moment of signing,
        plus a meaning: Authored, Reviewed, Approved or Witnessed. It is bound to
        one version of the record by its content hash, so any later change needs
        an amendment and a new signature.
      </p>
      <h2 className="text-doc-heading text-foreground">
        What reviewers see
      </h2>
      <p className="text-prose text-foreground">
        Reviewers see changes since their last review marked in the margin, can
        comment on any block or cell, and either sign or return the record with
        comments. They can&rsquo;t edit the author&rsquo;s content.
      </p>
      <div className="flex gap-2">
        <Button asChild variant="primary">
          <Link to="/settings">Set up your signature</Link>
        </Button>
        <Button variant="secondary" onClick={requestShortcutsDialog}>
          Keyboard shortcuts
        </Button>
      </div>
    </article>
  )
}

interface LifecycleStage {
  x: number
  y: number
  width: number
  label: string
  detail: string
  dot: string
}

const STAGES: LifecycleStage[] = [
  { x: 10, y: 40, width: 160, label: 'Draft', detail: 'Only you can see it', dot: 'var(--neutral-dot)' },
  { x: 230, y: 40, width: 170, label: 'In progress', detail: 'Team can edit; autosaves', dot: 'var(--accent)' },
  { x: 460, y: 40, width: 170, label: 'In review', detail: 'Locked for the author', dot: 'var(--review)' },
  { x: 700, y: 40, width: 250, label: 'Approved · signed', detail: 'Locked; PDF and hash kept', dot: 'var(--success)' },
  { x: 460, y: 200, width: 170, label: 'Returned', detail: 'Comments to resolve', dot: 'var(--warning)' },
  { x: 700, y: 200, width: 250, label: 'Amendment · version 2', detail: 'Copy with a reason; new review', dot: 'var(--accent)' },
]

const FLOWS = [
  { d: 'M170 68L226 68', label: 'Start', lx: 180, ly: 60 },
  { d: 'M400 68L456 68', label: 'Submit', lx: 406, ly: 60 },
  { d: 'M630 68L696 68', label: 'Sign', lx: 648, ly: 60 },
  { d: 'M545 96L545 196', label: 'Return', lx: 552, ly: 150 },
  { d: 'M460 228L315 100', label: 'Resubmit after edits', lx: 300, ly: 160 },
  { d: 'M825 96L825 196', label: 'Create amendment', lx: 832, ly: 150 },
  { d: 'M700 228L634 100', label: '', lx: 0, ly: 0 },
] as const

function RecordLifecycleDiagram() {
  return (
    <svg
      width={980}
      height={300}
      viewBox="0 0 980 300"
      role="img"
      aria-label="Record lifecycle: Draft, In progress, In review, then Approved and locked, or Returned to In progress. An approved record changes only through an amendment, which becomes a new version in review."
      className="max-w-full"
    >
      <defs>
        <marker
          id="help-lifecycle-arrow"
          viewBox="0 0 8 8"
          refX={7}
          refY={4}
          markerWidth={8}
          markerHeight={8}
          orient="auto"
        >
          <path d="M0 0L8 4L0 8z" style={{ fill: 'var(--text-muted)' }} />
        </marker>
      </defs>
      {STAGES.map((stage) => (
        <g key={stage.label}>
          <rect
            x={stage.x}
            y={stage.y}
            width={stage.width}
            height={56}
            rx={6}
            style={{ fill: 'var(--surface)', stroke: 'var(--border-strong)' }}
          />
          <circle
            cx={stage.x + 16}
            cy={stage.y + 21}
            r={4}
            style={{ fill: stage.dot }}
          />
          <text
            x={stage.x + 28}
            y={stage.y + 25}
            fontSize={13}
            fontWeight={600}
            style={{ fill: 'var(--text)' }}
          >
            {stage.label}
          </text>
          <text
            x={stage.x + 16}
            y={stage.y + 44}
            fontSize={11}
            style={{ fill: 'var(--text-muted)' }}
          >
            {stage.detail}
          </text>
        </g>
      ))}
      {FLOWS.map((flow, index) => (
        <g key={index}>
          <path
            d={flow.d}
            markerEnd="url(#help-lifecycle-arrow)"
            strokeWidth={1.4}
            fill="none"
            style={{ stroke: 'var(--text-muted)' }}
          />
          {flow.label ? (
            <text
              x={flow.lx}
              y={flow.ly}
              fontSize={11}
              style={{ fill: 'var(--text-muted)' }}
            >
              {flow.label}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  )
}
