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
import { CodeBlock } from '#/components/v3/ui/code-block'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import type {
  CheckItemResult,
  OverallCheckStatus,
  ReviewCheckResultWire,
} from '#/lib/review-checks'
import { cn } from '@/lib/utils'
import { t } from '#/copy'

const overallStatusConfig: Record<
  OverallCheckStatus,
  { className: string; icon: IconName }
> = {
  pass: {
    className: 'text-success-text',
    icon: 'check',
  },
  warning: {
    className: 'text-warning-text',
    icon: 'warn',
  },
  fail: {
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
          {t(
            `projects.checkResults.severity.${item.severity}`,
          )}
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
            {t('projects.checkResults.evidence')}
          </div>
          <CodeBlock
            code={formatEvidence(item.evidence)}
            language="json"
            label={t('projects.checkResults.evidenceFor', {
              label: item.label,
            })}
            maxHeight="md"
          />
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
          {t(`projects.checkResults.overall.${result.overall_status}`)}
        </span>
      </div>

      <div className="flex flex-wrap gap-3 text-label text-fg-muted">
        <span>
          {t('projects.checkResults.passed', { count: result.pass_count })}
        </span>
        {result.blocking_failure_count > 0 && (
          <span className="text-danger-text">
            {t('projects.checkResults.blocking', {
              count: result.blocking_failure_count,
            })}
          </span>
        )}
        {result.warning_failure_count > 0 && (
          <span className="text-warning-text">
            {t('projects.checkResults.warnings', {
              count: result.warning_failure_count,
            })}
          </span>
        )}
        {result.info_failure_count > 0 && (
          <span className="flex items-center gap-1 text-link">
            <Icon name="info" size={12} aria-hidden="true" />
            {t('projects.checkResults.informational', {
              count: result.info_failure_count,
            })}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="text-label font-medium uppercase tracking-wide text-fg-muted">
          {t('projects.checkResults.definition', {
            key: result.check_definition_key,
            version: result.check_definition_version,
          })}
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
