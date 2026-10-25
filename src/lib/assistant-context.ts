import type { AiObjectRefKind } from './ai-context'

/**
 * The page context the assistant may use. Only stable ids are carried; the
 * question never includes scraped page text.
 */
export interface AssistantPageContext {
  kind: AiObjectRefKind
  id: string
}

export const OPEN_ASSISTANT_EVENT = 'sheetbase:open-assistant'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

const PATTERNS: Array<{ pattern: RegExp; kind: AiObjectRefKind }> = [
  { pattern: new RegExp(`^/datasets/(${UUID})(?:/|$)`, 'i'), kind: 'dataset' },
  { pattern: new RegExp(`^/sheets/(${UUID})(?:/|$)`, 'i'), kind: 'sheet' },
  { pattern: new RegExp(`^/analysis/(${UUID})(?:/|$)`, 'i'), kind: 'analysis' },
  { pattern: new RegExp(`^/records/(${UUID})(?:/|$)`, 'i'), kind: 'record' },
  {
    pattern: new RegExp(`^/experiments/(${UUID})(?:/|$)`, 'i'),
    kind: 'record',
  },
  { pattern: new RegExp(`^/samples/(${UUID})(?:/|$)`, 'i'), kind: 'record' },
  { pattern: new RegExp(`^/materials/(${UUID})(?:/|$)`, 'i'), kind: 'record' },
  {
    pattern: new RegExp(`^/protocols/(${UUID})(?:/|$)`, 'i'),
    kind: 'record',
  },
  {
    pattern: new RegExp(`^/instruments/(${UUID})(?:/|$)`, 'i'),
    kind: 'record',
  },
]

const KIND_LABELS: Record<AiObjectRefKind, string> = {
  record: 'Record',
  notebook: 'Notebook',
  sheet: 'Sheet',
  dataset: 'Dataset',
  analysis: 'Analysis',
}

/**
 * Derive a stable object reference from the current URL. Identifier-based
 * routes redirect to their canonical UUID form, so a non-UUID here means the
 * page has no stable object to attach.
 */
export function contextFromPathname(
  pathname: string,
): AssistantPageContext | null {
  for (const { pattern, kind } of PATTERNS) {
    const match = pattern.exec(pathname)
    if (match?.[1]) return { kind, id: match[1] }
  }
  return null
}

export function contextKindLabel(kind: AiObjectRefKind): string {
  return KIND_LABELS[kind]
}

/** Open the global assistant without coupling the caller to its state. */
export function openAssistant(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT))
}
