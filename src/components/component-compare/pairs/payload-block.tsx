import { CodeBlock } from '#/components/v3/ui/code-block'
import {
  ComparisonEmptyState,
  ComparisonErrorState,
  ComparisonLoadingRows,
  ComparisonRestrictedNotice,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonPair,
  ComparisonRow,
} from '#/components/component-compare/types'

/**
 * Pair — code and raw-payload display.
 *
 * **Ours.** The four hand-rolled renderings, reproduced here because the
 * migration replaced them: the pipeline step block (the app's one deliberate
 * payload renderer: labelled, focusable, with an empty state), and three ad-hoc
 * `<pre>`s — the agent surface's before/after JSON pair, the run history's
 * technical result payload inside a `<details>`, and the parser settings'
 * validation evidence. Four class strings, four max-heights, three of them with
 * no label, no empty state and no way to copy — and the two JSON ones are
 * exactly what a person pastes into a bug report.
 *
 * **The registry candidate was measured and declined before a column was worth
 * building.** `@reui/code-block` is a ReUI-native item, 3,402 lines of
 * copy-and-own source across two files, and it depends on `shiki@4`, which
 * installs 13.1 MB across 1,062 files (9.0 MB of it language grammars) — for
 * highlighting, streaming, diffs, folding and per-line interaction, none of
 * which this job has. Its own registry dependencies resolve `button` into the
 * legacy Radix kit §11.3.1 warns about. ADR-0055 decision 4 asks for a *named
 * missing behaviour*; the missing behaviour here is a copy control and a bound,
 * which is our own component's worth. The record's row carries the numbers, and
 * what would reverse the decline.
 *
 * **Theirs** is therefore the in-house v3 `CodeBlock`. The fixture's payload is
 * the row itself — mixed types, nulls, high precision, long scientific names —
 * so the same hostile text reaches both columns.
 */

/** The four shipped renderings, in the order they were found. */
const SHIPPED = [
  { site: 'v3/pipelines/pipeline-code.tsx:55-116', shape: 'labelled' },
  { site: 'v3/pipelines/agents/agent-surface.tsx:117-126', shape: 'json-pair' },
  { site: 'v3/integrations/run-history.tsx:201-208', shape: 'plugin' },
  { site: 'v3/settings/parser-settings.tsx:242-246', shape: 'wrapped' },
  { site: 'review/review-check-results.tsx:124', shape: 'evidence' },
] as const

function shippedFor(row: ComparisonRow) {
  return SHIPPED[Number(row.id.slice(-4)) % SHIPPED.length]
}

/** The payload both columns render: the row itself, as JSON. */
function payloadFor(row: ComparisonRow) {
  return JSON.stringify(
    {
      name: row.name,
      unit: row.unit,
      value: row.value,
      note: row.note,
      kind: row.kind,
    },
    null,
    2,
  )
}

function PayloadOursColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div className="flex flex-col gap-1" data-comparison-list="ours">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      {rows.map((row) => {
        const shipped = shippedFor(row)
        const payload = payloadFor(row)
        return (
          <div
            key={row.id}
            data-row-id={row.id}
            data-shape={shipped.shape}
            className="min-w-0 rounded-md border border-transparent px-3 py-2"
          >
            {shipped.shape === 'labelled' ? (
              <>
                <span
                  data-slot="code-language"
                  className="mono text-[10px] tracking-[.02em] text-fg-muted uppercase"
                >
                  json
                </span>
                <pre
                  tabIndex={0}
                  role="group"
                  aria-label={`Payload for ${row.name}`}
                  className="m-0 overflow-auto rounded-md border border-border bg-surface p-3 text-caption whitespace-pre focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                >
                  <code className="mono">{payload}</code>
                </pre>
              </>
            ) : shipped.shape === 'json-pair' ? (
              <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-muted p-2 text-[11px] leading-4">
                {payload}
              </pre>
            ) : shipped.shape === 'plugin' ? (
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-surface p-2 text-label">
                {payload}
              </pre>
            ) : shipped.shape === 'wrapped' ? (
              <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap break-words text-label">
                {payload}
              </pre>
            ) : (
              <pre className="max-h-48 overflow-auto rounded bg-surface-muted p-2 text-label leading-relaxed">
                {payload}
              </pre>
            )}
          </div>
        )
      })}
    </div>
  )
}

function PayloadTheirsColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div className="flex flex-col gap-1" data-comparison-list="theirs">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      {rows.map((row) => (
        <div
          key={row.id}
          data-row-id={row.id}
          className="min-w-0 rounded-md border border-transparent px-3 py-2"
        >
          <CodeBlock
            code={payloadFor(row)}
            language="json"
            label={`Payload for ${row.name}`}
            maxHeight="sm"
          />
        </div>
      ))}
    </div>
  )
}

export const payloadBlockPair: ComparisonPair = {
  id: 'payload-block',
  title: 'Code and raw-payload block',
  job: 'Show a statement or a raw payload as text, and let it be copied',
  controls: [],
  ours: {
    id: 'ours',
    label: 'Ours — four hand-rolled <pre> renderings',
    source:
      'v3/pipelines/pipeline-code.tsx, v3/pipelines/agents/agent-surface.tsx, v3/integrations/run-history.tsx, v3/settings/parser-settings.tsx, review/review-check-results.tsx',
    Column: PayloadOursColumn,
  },
  theirs: {
    id: 'theirs',
    label:
      'Theirs — v3 CodeBlock (in-house; @reui/code-block measured and declined)',
    source: 'src/components/v3/ui/code-block.tsx',
    Column: PayloadTheirsColumn,
  },
}
