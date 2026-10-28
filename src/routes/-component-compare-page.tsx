import { ComponentCompare } from '#/components/component-compare/harness'
import { COMPARISON_PAIRS } from '#/components/component-compare/pairs'

/**
 * The A/B component comparison harness (ADR-0055).
 *
 * A development-only surface, like `/foundations` and `/sheetbase-components`:
 * production builds redirect to `/`, it carries no business data, and it is not
 * part of the product navigation. It renders our implementation and a registry
 * candidate on one shared fixture set with one shared behavioural checklist, so
 * an adoption decision has evidence instead of an opinion.
 *
 * Results are recorded per pair in
 * `docs/knowledge/design/component-comparison-record.md`; the runbook is
 * `docs/development/component-compare.md`.
 */
export function ComponentCompareRoute() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <ComponentCompare pairs={COMPARISON_PAIRS} />
    </div>
  )
}
