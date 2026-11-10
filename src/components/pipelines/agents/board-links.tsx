import { Fragment } from 'react'

const ROUTES = new Map([
  ['EXP', '/experiments/'],
  ['DS', '/datasets/'],
  ['PRT', '/protocols/'],
  ['SMP', '/samples/'],
])

/** Turn record identifiers in a sentence into links to those records. */
export function linkifyIdentifiers(text: string): React.ReactNode {
  const parts = text.split(/\b((?:EXP|DS|PRT|SMP)-\d{4})\b/)
  let offset = 0

  return parts.map((part, index) => {
    const start = offset
    offset += part.length
    const prefix = part.slice(0, part.indexOf('-'))
    const route = ROUTES.get(prefix)

    return index % 2 === 1 && route ? (
      <a key={`link-${start}`} href={`${route}${part}`} className="text-link">
        {part}
      </a>
    ) : (
      <Fragment key={`text-${start}`}>{part}</Fragment>
    )
  })
}
