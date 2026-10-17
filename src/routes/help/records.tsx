import { Link, createFileRoute } from '@tanstack/react-router'

import { Breadcrumb } from '#/components/v3/ui/breadcrumb'
import { buttonVariants } from '#/components/v3/ui/button'

/** Static release help. Lifecycle labels describe states, not workspace records. */
export const Route = createFileRoute('/help/records')({
  component: RecordsArticle,
})

const lifecycle = [
  {
    x: 10,
    y: 40,
    width: 160,
    tone: 'var(--color-neutral-dot)',
    label: 'Draft',
    detail: 'Only you can see it',
  },
  {
    x: 230,
    y: 40,
    width: 170,
    tone: 'var(--color-link)',
    label: 'In progress',
    detail: 'Team can edit; autosaves',
  },
  {
    x: 460,
    y: 40,
    width: 170,
    tone: 'var(--color-review)',
    label: 'In review',
    detail: 'Locked for the author',
  },
  {
    x: 700,
    y: 40,
    width: 250,
    tone: 'var(--color-success)',
    label: 'Approved · signed',
    detail: 'Locked; PDF and hash kept',
  },
  {
    x: 460,
    y: 200,
    width: 170,
    tone: 'var(--color-warning)',
    label: 'Returned',
    detail: 'Comments to resolve',
  },
  {
    x: 700,
    y: 200,
    width: 250,
    tone: 'var(--color-link)',
    label: 'Amendment · version 2',
    detail: 'Copy with a reason; new review',
  },
]

function RecordsArticle() {
  return (
    <div className="min-h-full min-w-0 bg-surface">
      <header className="flex flex-col gap-1.5 border-b border-border px-4 pb-3 pt-4 md:px-8">
        <Breadcrumb
          trail={[{ label: 'Home', link: { to: '/' } }, { label: 'Help' }]}
          className="font-normal leading-[normal]"
        />
        <h1 className="m-0 text-title leading-[normal]">
          How records, reviews and signatures work
        </h1>
      </header>
      <article className="flex min-w-0 flex-col gap-4 px-4 py-6 md:px-8">
        <p className="m-0 max-w-[680px] text-prose">
          Every experiment, dataset and protocol moves through the same states.
          What you can change depends on the state, and every change is written
          to History with who, when, the old value and the reason.
        </p>
        <div className="min-w-0 overflow-x-auto">
          <StateDiagram />
        </div>
        <h2 id="signatures" className="m-0 text-doc leading-[normal]">
          Signatures
        </h2>
        <p className="m-0 max-w-[680px] text-prose">
          A signature is your password entered again at the moment of signing,
          plus a meaning: Authored, Reviewed, Approved or Witnessed. It is bound
          to one version of the record by its content hash, so any later change
          needs an amendment and a new signature.
        </p>
        <h2 id="reviews" className="m-0 text-doc leading-[normal]">
          What reviewers see
        </h2>
        <p className="m-0 max-w-[680px] text-prose">
          Reviewers see changes since their last review marked in the margin,
          can comment on any block or cell, and either sign or return the record
          with comments. They can’t edit the author’s content.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/settings/signatures"
            className={buttonVariants({ variant: 'primary' })}
          >
            Set up your signature
          </Link>
          <Link to="/help/shortcuts" className={buttonVariants()}>
            Keyboard shortcuts
          </Link>
        </div>
      </article>
    </div>
  )
}

function StateDiagram() {
  return (
    <svg
      width="980"
      height="300"
      viewBox="0 0 980 300"
      role="img"
      aria-label="Record lifecycle: Draft, In progress, In review, then Approved and locked, or Returned to In progress. An approved record changes only through an amendment, which becomes a new version in review."
      className="text-fg-muted"
    >
      <defs>
        <marker
          id="lifecycle-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="8"
          markerHeight="8"
          orient="auto"
        >
          <path d="M0 0L8 4L0 8z" fill="currentColor" />
        </marker>
      </defs>
      {lifecycle.map(({ x, y, width, tone, label, detail }) => (
        <g key={label}>
          <rect
            x={x}
            y={y}
            width={width}
            height="56"
            rx="6"
            fill="var(--color-surface)"
            stroke="var(--color-border-strong)"
          />
          <circle cx={x + 16} cy={y + 21} r="4" fill={tone} />
          <text
            x={x + 28}
            y={y + 25}
            fontSize="13"
            fontWeight="600"
            fill="var(--color-fg)"
          >
            {label}
          </text>
          <text x={x + 16} y={y + 44} fontSize="11" fill="currentColor">
            {detail}
          </text>
        </g>
      ))}
      <g
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
        markerEnd="url(#lifecycle-arrow)"
      >
        <path d="M170 68L226 68" />
        <path d="M400 68L456 68" />
        <path d="M630 68L696 68" />
        <path d="M545 96L545 196" />
        <path d="M460 228L315 100" />
        <path d="M825 96L825 196" />
        <path d="M700 228L634 100" />
      </g>
      <g fontSize="11" fill="currentColor">
        <text x="180" y="60">
          Start
        </text>
        <text x="406" y="60">
          Submit
        </text>
        <text x="648" y="60">
          Sign
        </text>
        <text x="552" y="150">
          Return
        </text>
        <text x="300" y="160">
          Resubmit after edits
        </text>
        <text x="832" y="150">
          Create amendment
        </text>
      </g>
    </svg>
  )
}
