import { parseMatchedContext } from '#/lib/search'
import type { ContextSegment, SearchResult } from '#/lib/search'

/** The fields of a result that decide how its text reads. */
type ResultText = Pick<SearchResult, 'identifier' | 'recordId'>

/**
 * `api.search` fills `identifier` with the object's own primary key for the
 * object classes that have no display identifier of their own (working sheets
 * and datasets), so the field says nothing a person can use.
 */
function carriesOwnId(result: ResultText): boolean {
  const identifier = result.identifier.trim()
  return !identifier || identifier === result.recordId
}

/**
 * The identifier a person can quote for a result row, or `null` when the row
 * carries none — printing the object's own id there would put a 36-character
 * UUID in front of the title the person recognises. Such a row leads with its
 * title instead.
 */
export function searchResultLabel(result: ResultText): string | null {
  return carriesOwnId(result) ? null : result.identifier.trim()
}

/**
 * The matched snippet as alternating plain and highlighted segments.
 *
 * `api.search` returns ts_headline output, so the snippet arrives with `<b>`
 * around the match and — for sheets and datasets — with the object's own id
 * folded into the text it headlines, as if someone had written the UUID. The
 * markup is parsed rather than rendered, and the row's own id is dropped: what
 * is left is the snippet a person reads.
 */
export function searchResultContext(
  result: ResultText,
  context: string,
): ContextSegment[] {
  const segments = parseMatchedContext(context)
  if (!carriesOwnId(result)) return segments
  const ownId = result.recordId.trim()
  if (!ownId) return segments
  return segments.map((segment) =>
    segment.text.includes(ownId)
      ? {
          ...segment,
          text: segment.text.split(ownId).join('').replace(/\s{2,}/g, ' '),
        }
      : segment,
  )
}
