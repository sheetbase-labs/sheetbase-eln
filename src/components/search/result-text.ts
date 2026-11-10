import { parseMatchedContext } from '#/lib/search'
import { t } from '#/copy'
import type { ContextSegment, SearchResult } from '#/lib/search'

/** The fields of a result that decide how its text reads. */
type ResultText = Pick<SearchResult, 'identifier' | 'recordId'> & {
  title?: string
}

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
  // The row already leads with its id and its title, so the snippet drops the
  // row's own id wherever it was folded in, and says nothing at all when what
  // is left only repeats the title.
  const ownIds = [result.recordId, result.identifier].flatMap((id) => {
    const text = id.trim()

    return text ? [text] : []
  })

  const segments = parseMatchedContext(context)
    .map((segment) => {
      let text = segment.text

      for (const id of ownIds) text = text.split(id).join('')

      return text === segment.text
        ? segment
        : { ...segment, text: text.replace(/\s{2,}/g, ' ') }
    })
    // The service joins title, identifier and body with a dash; an empty cell
    // leaves "— —" behind, so a run of dashes reads as one.
    .map((segment) => ({
      ...segment,
      text: segment.text.replace(/(?:\s*—\s*){2,}/g, ' — '),
    }))
    .filter((segment) => segment.text.trim() !== '')

  // Dropping the row's own id from "Title — PRJ-0002" leaves "Title — ": a
  // separator with nothing after it. Trim one left at either end.
  const edges = [...segments]

  if (edges.length) {
    const last = edges.length - 1
    edges[0] = { ...edges[0], text: edges[0].text.replace(/^\s*—\s*/, '') }
    edges[last] = {
      ...edges[last],
      text: edges[last].text.replace(/\s*—\s*$/, ''),
    }
  }

  const trimmed = dropTitleKey(
    dropTitlePrefix(
      edges.filter((segment) => segment.text.trim() !== ''),
      result.title ?? '',
    ),
    result.title ?? '',
  )

  const plain = trimmed.map((segment) => segment.text).join('')

  if (collapse(plain) === collapse(result.title ?? '')) return []

  return trimmed
}

/**
 * A project or pipeline folds its machine key into the text it headlines
 * (ambr-250-perfusion-scale-down after "Ambr 250 perfusion scale-down"). The key
 * is the title's own words joined by - or _, so cut that run out wherever it is.
 */
function dropTitleKey(
  segments: ContextSegment[],
  title: string,
): ContextSegment[] {
  const words = title.toLowerCase().match(/[a-z0-9]+/g) ?? []

  if (words.length < 2) return segments
  const plain = segments.map((segment) => segment.text).join('')
  const found = new RegExp(words.join('[-_]'), 'i').exec(plain)

  if (!found) return segments
  const start = found.index
  const end = start + found[0].length
  const kept: ContextSegment[] = []
  let at = 0

  for (const segment of segments) {
    const from = at
    const to = at + segment.text.length
    at = to

    for (const text of [
      segment.text.slice(0, Math.max(0, Math.min(to, start) - from)),
      segment.text.slice(Math.max(0, Math.max(from, end) - from)),
    ]) {
      if (text.trim() !== '') kept.push({ ...segment, text })
    }
  }

  return kept
}

/**
 * The service headlines "Title — body", but the row already shows the title
 * beside the snippet. When the snippet opens with the title and a separator,
 * cut them, so the Match column says only what the title does not.
 */
function dropTitlePrefix(
  segments: ContextSegment[],
  title: string,
): ContextSegment[] {
  const words = title.trim()

  if (!words) return segments

  const escaped = words
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+')

  const match = segments
    .map((segment) => segment.text)
    .join('')
    .match(new RegExp(`^\\s*${escaped}\\s*—\\s*`, 'i'))

  if (!match) return segments
  let cut = match[0].length
  const rest: ContextSegment[] = []

  for (const segment of segments) {
    if (cut >= segment.text.length) {
      cut -= segment.text.length
      continue
    }

    rest.push(cut ? { ...segment, text: segment.text.slice(cut) } : segment)
    cut = 0
  }

  return rest
}

const collapse = (text: string) =>
  text.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Where a nested hit sits ("Comment on Buffer prep", "Row in dataset DS-0311"),
 * or null for a hit that is the thing itself.
 */
export function searchResultParentLine(
  result: Pick<SearchResult, 'resultType' | 'parentTitle'> &
    Partial<Pick<SearchResult, 'matchedFileName'>>,
): string | null {
  // A notebook found through a file it embeds says which file.
  const file = result.matchedFileName?.trim()

  if (file) return t('projects.search.inEmbeddedFile', { file })
  const parent = result.parentTitle.trim()

  if (!parent) return null

  switch (result.resultType) {
    case 'comment':
      return t('projects.search.commentOn', { parent })
    case 'dataset_row':
      return t('projects.search.rowInDataset', { parent })
    case 'sheet_row':
      return t('projects.search.rowInSheet', { parent })
    default:
      return t('projects.search.inParent', { parent })
  }
}
