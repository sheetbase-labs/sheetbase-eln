/**
 * REV-005: reviewer check results display with per-item evidence inspection.
 *
 * Renders the immutable check results from a frozen revision, distinguishing
 * blocking failures, warnings and informational checks. Each item can be
 * expanded to inspect the evidence behind its result.
 */

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Info,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'

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
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  pass: {
    label: 'All checks passed',
    className: 'text-emerald-600 dark:text-emerald-400',
    icon: CheckCircle2,
  },
  warning: {
    label: 'Passed with warnings',
    className: 'text-amber-600 dark:text-amber-400',
    icon: AlertTriangle,
  },
  fail: {
    label: 'Blocking failures',
    className: 'text-red-600 dark:text-red-400',
    icon: XCircle,
  },
}

function itemIcon(status: CheckItemResult['status']) {
  if (status === 'pass') {
    return (
      <CheckCircle2
        className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-hidden="true"
      />
    )
  }
  return (
    <XCircle
      className="size-4 shrink-0 text-red-600 dark:text-red-400"
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
    <li className="rounded-md border border-border/60">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {itemIcon(item.status)}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {item.label}
        </span>
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            item.severity === 'blocking' &&
              'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
            item.severity === 'warning' &&
              'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
            item.severity === 'informational' &&
              'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
          )}
        >
          {severityLabel[item.severity]}
        </span>
        {hasEvidence && (
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              expanded && 'rotate-180',
            )}
            aria-hidden="true"
          />
        )}
        <span className="sr-only">{item.status}</span>
      </button>
      {expanded && hasEvidence && (
        <div className="border-t border-border/60 px-3 py-2">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Evidence
          </div>
          <pre className="max-h-48 overflow-auto rounded bg-muted/50 p-2 text-[11px] leading-relaxed">
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
  const OverallIcon = config.icon

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <OverallIcon
          className={cn('size-5 shrink-0', config.className)}
          aria-hidden="true"
        />
        <span className={cn('text-sm font-semibold', config.className)}>
          {config.label}
        </span>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>{result.pass_count} passed</span>
        {result.blocking_failure_count > 0 && (
          <span className="text-red-600 dark:text-red-400">
            {result.blocking_failure_count} blocking
          </span>
        )}
        {result.warning_failure_count > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            {result.warning_failure_count} warnings
          </span>
        )}
        {result.info_failure_count > 0 && (
          <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
            <Info className="size-3" aria-hidden="true" />
            {result.info_failure_count} informational
          </span>
        )}
      </div>

      <div className="space-y-1">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Definition: {result.check_definition_key} v
          {result.check_definition_version}
        </div>
        <div className="font-mono text-[10px] text-muted-foreground/70">
          {result.revision_integrity_digest.slice(0, 16)}…
        </div>
      </div>

      <ul className="space-y-1">
        {result.results.map((item) => (
          <CheckResultItem key={item.key} item={item} />
        ))}
      </ul>
    </div>
  )
}
