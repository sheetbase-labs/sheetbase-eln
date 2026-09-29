/**
 * REV-005: reviewer check results display with per-item evidence inspection.
 * UI port: app-3's v3 kit.
 *
 * Renders the immutable check results from a frozen revision, distinguishing
 * blocking failures, warnings and informational checks. Each item can be
 * expanded to inspect the evidence behind its result.
 */

import { useState } from 'react'

import { Badge } from '#/components/v3/ui/badge'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import type {
  CheckItemResult,
  CheckSeverity,
  OverallCheckStatus,
  ReviewCheckResultWire,
} from '#/lib/review-checks'
import { cn } from '@/lib/utils'

const severityLabel: Record<CheckSeverity, string> = {
  blocking: 'Blocking',
  warning: 'Warning',
  informational: 'Informational',
}

const overallStatusConfig: Record<
  OverallCheckStatus,
  { label: string; className: string; icon: IconName }
> = {
  pass: {
    label: 'All checks passed',
    className: 'text-success-text',
    icon: 'check',
  },
  warning: {
    label: 'Passed with warnings',
    className: 'text-warning-text',
    icon: 'warn',
  },
  fail: {
    label: 'Blocking failures',
    className: 'text-danger-text',
    icon: 'x',
  },
}

function itemIcon(status: CheckItemResult['status']) {
  if (status === 'pass') {
    return (
      <Icon
        name="check"
        size={16}
        className="shrink-0 text-success-text"
        aria-hidden="true"
      />
    )
  }
  return (
    <Icon
      name="x"
      size={16}
      className="shrink-0 text-danger-text"
      aria-hidden="true"
    />
  )
}

function formatEvidence(evidence: Record<string, unknown>): string {
  try {
    return JSON.stringify(evidence, null, 2)
  } catch {
    return String(evidence)
  }
}

function CheckResultItem({ item }: { item: CheckItemResult }) {
  const [expanded, setExpanded] = useState(false)
  const hasEvidence = Object.keys(item.evidence).length > 0

  return (
    <li className="rounded-md border border-border-subtle">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {itemIcon(item.status)}
        <span className="min-w-0 flex-1 truncate text-label font-medium">
          {item.label}
        </span>
        <Badge
          variant={
            item.severity === 'blocking'
              ? 'del'
              : item.severity === 'warning'
                ? 'chg'
                : 'kind'
          }
        >
          {severityLabel[item.severity]}
        </Badge>
        {hasEvidence && (
          <Icon
            name="chevronDown"
            size={14}
            className={cn(
              'shrink-0 text-fg-muted transition-transform',
              expanded && 'rotate-180',
            )}
            aria-hidden="true"
          />
        )}
        <span className="sr-only">{item.status}</span>
      </button>
      {expanded && hasEvidence && (
        <div className="border-t border-border-subtle px-3 py-2">
          <div className="mb-1 text-label font-medium uppercase tracking-wide text-fg-muted">
            Evidence
          </div>
          <pre className="max-h-48 overflow-auto rounded bg-surface-muted p-2 text-label leading-relaxed">
            {formatEvidence(item.evidence)}
          </pre>
        </div>
      )}
    </li>
  )
}

export interface ReviewCheckResultsProps {
  result: ReviewCheckResultWire
}

/**
 * Display immutable reviewer check results for a frozen revision. Shows the
 * overall status, summary counts, and an expandable list of per-item results
 * with evidence inspection.
 */
export function ReviewCheckResults({ result }: ReviewCheckResultsProps) {
  const config = overallStatusConfig[result.overall_status]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon
          name={config.icon}
          size={20}
          className={cn('shrink-0', config.className)}
          aria-hidden="true"
        />
        <span className={cn('text-body font-semibold', config.className)}>
          {config.label}
        </span>
      </div>

      <div className="flex flex-wrap gap-3 text-label text-fg-muted">
        <span>{result.pass_count} passed</span>
        {result.blocking_failure_count > 0 && (
          <span className="text-danger-text">
            {result.blocking_failure_count} blocking
          </span>
        )}
        {result.warning_failure_count > 0 && (
          <span className="text-warning-text">
            {result.warning_failure_count} warnings
          </span>
        )}
        {result.info_failure_count > 0 && (
          <span className="flex items-center gap-1 text-link">
            <Icon name="info" size={12} aria-hidden="true" />
            {result.info_failure_count} informational
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="text-label font-medium uppercase tracking-wide text-fg-muted">
          Definition: {result.check_definition_key} v
          {result.check_definition_version}
        </div>
        <div className="mono text-label text-fg-muted">
          {result.revision_integrity_digest.slice(0, 16)}…
        </div>
      </div>

      <ul className="m-0 list-none space-y-1 p-0">
        {result.results.map((item) => (
          <CheckResultItem key={item.key} item={item} />
        ))}
      </ul>
    </div>
  )
}
