import { Link, createFileRoute } from '@tanstack/react-router'

import { Breadcrumb } from '#/components/v3/ui/breadcrumb'
import { buttonVariants } from '#/components/v3/ui/button'
import { t } from '#/copy'

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
    label: t('settings.help.records.draft'),
    detail: t('settings.help.records.onlySee'),
  },
  {
    x: 230,
    y: 40,
    width: 170,
    tone: 'var(--color-link)',
    label: t('settings.help.records.progress'),
    detail: t('settings.help.records.teamEditAutosaves'),
  },
  {
    x: 460,
    y: 40,
    width: 170,
    tone: 'var(--color-review)',
    label: t('settings.help.records.review'),
    detail: t('settings.help.records.lockedAuthor'),
  },
  {
    x: 700,
    y: 40,
    width: 250,
    tone: 'var(--color-success)',
    label: t('settings.help.records.approvedSigned'),
    detail: t('settings.help.records.lockedPdfHash'),
  },
  {
    x: 460,
    y: 200,
    width: 170,
    tone: 'var(--color-warning)',
    label: t('settings.help.records.returned'),
    detail: t('settings.help.records.commentsResolve'),
  },
  {
    x: 700,
    y: 200,
    width: 250,
    tone: 'var(--color-link)',
    label: t('settings.help.records.amendmentVersion2'),
    detail: t('settings.help.records.copyReasonNew'),
  },
]

function RecordsArticle() {
  return (
    <div className="min-h-full min-w-0 bg-surface">
      <header className="flex flex-col gap-1.5 border-b border-border px-4 pb-3 pt-4 md:px-8">
        <Breadcrumb
          trail={[
            { label: t('settings.help.records.help'), link: { to: '/help' } },
            { label: t('settings.help.records.howRecordsWork') },
          ]}
          className="font-normal leading-[normal]"
        />
        <h1 className="m-0 text-title leading-[normal]">
          {t('settings.help.records.howRecordsReviews')}
        </h1>
      </header>
      <article className="flex min-w-0 flex-col gap-4 px-4 py-6 md:px-8">
        <p className="m-0 max-w-[680px] text-prose">
          {t('settings.help.records.everyExperimentDataset')}
        </p>
        <div className="min-w-0 overflow-x-auto">
          <StateDiagram />
        </div>
        <h2 id="signatures" className="m-0 text-doc leading-[normal]">
          {t('settings.help.records.signatures')}
        </h2>
        <p className="m-0 max-w-[680px] text-prose">
          {t('settings.help.records.signaturePasswordEntered')}
        </p>
        <h2 id="reviews" className="m-0 text-doc leading-[normal]">
          {t('settings.help.records.whatReviewersSee')}
        </h2>
        <p className="m-0 max-w-[680px] text-prose">
          {t('settings.help.records.reviewersSeeChanges')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/settings/my-signature"
            className={buttonVariants({ variant: 'primary' })}
          >
            {t('settings.help.records.setUpSignature')}
          </Link>
          <Link to="/help/shortcuts" className={buttonVariants()}>
            {t('settings.help.records.keyboardShortcuts')}
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
      aria-label={t('settings.help.records.recordLifecycleDraftAria')}
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
          {t('settings.help.records.start')}
        </text>
        <text x="406" y="60">
          {t('common.actions.submit')}
        </text>
        <text x="648" y="60">
          {t('settings.help.records.sign')}
        </text>
        <text x="552" y="150">
          {t('settings.help.records.return')}
        </text>
        <text x="300" y="160">
          {t('settings.help.records.resubmitAfterEdits')}
        </text>
        <text x="832" y="150">
          {t('settings.help.records.createAmendment')}
        </text>
      </g>
    </svg>
  )
}
