import { useQuery } from '@tanstack/react-query'

import { ExplainPanel } from '#/components/assist/explain-panel'
import { phraseExplanation } from '#/lib/assist-explain'
import type { AssistExplanation } from '#/lib/assist-explain'
import { usePageAi } from '#/lib/use-page-ai'

/**
 * The grounded explanation, plus a plain-words rewording from the workspace's
 * model when AI is available. With AI off the panel is exactly the facts.
 */
export function AiExplainPanel({
  explanation,
}: {
  explanation: AssistExplanation
}) {
  const ai = usePageAi()
  const key = `${explanation.title}|${explanation.whatFailed}|${explanation.why.map((claim) => claim.text).join('|')}`

  const phrasing = useQuery({
    queryKey: ['page-ai', 'explain', ai.workspaceId, key],
    queryFn: () => phraseExplanation(explanation, ai.run),
    enabled: ai.live,
    staleTime: Infinity,
    retry: false,
  })

  return (
    <ExplainPanel explanation={explanation} phrasing={phrasing.data ?? null} />
  )
}
