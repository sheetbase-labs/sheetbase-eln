/**
 * ASSIST-01 — read-only Explain panel.
 *
 * Renders a grounded explanation: what failed, why (one cited claim per
 * rule hit), how to resolve, and the cited sources. Grounded facts are
 * primary; optional model phrasing renders in a clearly marked assistance
 * block. The panel never mutates anything — it has no action that writes,
 * commits, or navigates away from the scientist's current context.
 */
import { ASSISTANCE_NOTE } from '#/lib/assist-explain'
import type { AssistExplanation, AssistPhrasing } from '#/lib/assist-explain'

export function ExplainPanel({
  explanation,
  phrasing,
}: {
  explanation: AssistExplanation
  phrasing?: AssistPhrasing | null
}) {
  return (
    <section
      aria-label={`Explain: ${explanation.title}`}
      className="space-y-2 rounded-md border bg-muted/20 p-2 text-xs"
    >
      <h4 className="font-semibold">{explanation.title}</h4>
      <p>{explanation.whatFailed}</p>
      <div className="space-y-1">
        <p className="font-medium text-muted-foreground">Why</p>
        <ul className="space-y-1">
          {explanation.why.map((claim, index) => (
            <li key={index}>
              <span>{claim.text}</span>{' '}
              <span className="text-muted-foreground">
                [{claim.citation.label}]
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-1">
        <p className="font-medium text-muted-foreground">How to resolve</p>
        <ul className="list-disc space-y-1 pl-4">
          {explanation.howTo.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ul>
      </div>
      {phrasing ? (
        <blockquote className="space-y-1 rounded border border-dashed p-2">
          <p className="font-medium text-muted-foreground">
            Assistance phrasing ({phrasing.model}) — verify against the
            citations
          </p>
          <p>{phrasing.text}</p>
        </blockquote>
      ) : null}
      <div className="space-y-1">
        <p className="font-medium text-muted-foreground">Cited sources</p>
        <ul className="space-y-1">
          {explanation.citations.map((citation, index) => (
            <li key={index} className="text-muted-foreground">
              <span className="font-mono">[{citation.label}]</span>{' '}
              {citation.detail}
              {citation.deepLink ? (
                <>
                  {' '}
                  <span className="font-mono">{citation.deepLink}</span>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-muted-foreground">{ASSISTANCE_NOTE}</p>
    </section>
  )
}
