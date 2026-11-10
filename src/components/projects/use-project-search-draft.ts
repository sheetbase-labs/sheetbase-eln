import { useEffect, useState } from 'react'

/**
 * The text in a search box, while the query that is actually applied lives in
 * the URL. Typing moves the draft; submitting moves the applied query; and a
 * URL that changes underneath the box — Back, or a link that carries a search —
 * moves the draft with it, so the box never states a query the list is not
 * showing.
 */
export function useSearchDraft(applied: string | undefined) {
  const [draft, setDraft] = useState(applied ?? '')

  useEffect(() => setDraft(applied ?? ''), [applied])

  return [draft, setDraft] as const
}
