/**
 * The home brief: what needs the person, and the next step for each of their
 * projects. The facts come from what Home already loads; the model only turns
 * them into a short read. Nothing here is sent unless the person asks for the
 * brief, and only counts, identifiers and titles the person can already see
 * on Home are included.
 */
import type { ProjectApprovalProgress } from './home-quiet'

export interface HomeBriefInput {
  reviews: { identifier: string; title: string; projectTitle: string | null }[]
  materials: { identifier: string; reason: string }[]
  datasetIssues: { identifier: string; label: string }[]
  todayBookings: number
  projects: ProjectApprovalProgress[]
}

export const HOME_BRIEF_INSTRUCTION =
  'Write a short brief for this scientist, in plain words. Begin with one line starting "Needs you:" naming what is waiting for them, most urgent first, or saying that nothing is. Then one bullet per project, starting with "- " and the project name, giving the single next step that follows from the numbers. Use only the facts supplied: no invented dates, names or advice beyond what the counts show. Keep it under 120 words.'

const MAX_LISTED = 8

export function homeBriefHasFacts(input: HomeBriefInput): boolean {
  return (
    input.reviews.length +
      input.materials.length +
      input.datasetIssues.length +
      input.todayBookings +
      input.projects.length >
    0
  )
}

/** The text sent to the model. Empty sections are left out. */
export function homeBriefFacts(input: HomeBriefInput): string {
  const lines: string[] = []
  const needs: string[] = []
  for (const review of input.reviews.slice(0, MAX_LISTED)) {
    needs.push(
      `- A review is waiting: ${review.identifier} ${review.title}${review.projectTitle ? ` (${review.projectTitle})` : ''}`,
    )
  }
  if (input.reviews.length > MAX_LISTED)
    needs.push(`- ${input.reviews.length - MAX_LISTED} more reviews waiting`)
  for (const material of input.materials.slice(0, MAX_LISTED)) {
    needs.push(`- Material ${material.identifier}: ${material.reason}`)
  }
  for (const issue of input.datasetIssues.slice(0, MAX_LISTED)) {
    needs.push(`- Dataset ${issue.identifier} needs attention: ${issue.label}`)
  }
  if (input.todayBookings > 0)
    needs.push(`- ${input.todayBookings} instrument booking(s) today`)
  lines.push('Needs the person:', ...(needs.length ? needs : ['- nothing']))
  if (input.projects.length > 0) {
    lines.push('', 'Projects:')
    for (const project of input.projects.slice(0, MAX_LISTED)) {
      const open = Math.max(
        0,
        project.total - project.approved - project.inReview,
      )
      lines.push(
        `- ${project.title}${project.stage ? ` (stage: ${project.stage})` : ''}: ${project.total} experiments, ${project.approved} approved, ${project.inReview} in review, ${open} not yet submitted`,
      )
    }
  }
  return lines.join('\n')
}

export interface BriefBlock {
  kind: 'paragraph' | 'bullet'
  text: string
}

/** Split the reply into paragraphs and bullets for display. */
export function parseBrief(text: string): BriefBlock[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      /^[-*•]\s+/.test(line)
        ? { kind: 'bullet' as const, text: line.replace(/^[-*•]\s+/, '') }
        : { kind: 'paragraph' as const, text: line },
    )
}

export type BriefPart =
  | { kind: 'text'; text: string }
  | { kind: 'object'; objectKind: string; ref: string; text: string }
  | { kind: 'route'; to: string; text: string }

/**
 * Turn the brief's text into parts, linking only what Home itself supplied:
 * the experiment, material and dataset identifiers and the project names the
 * person can see. An identifier the model invented stays plain text. Within a
 * project's bullet, "N experiments" opens that project's experiments.
 */
export function linkBrief(text: string, input: HomeBriefInput): BriefPart[] {
  const known = new Map<string, { objectKind: string; ref: string }>()
  for (const review of input.reviews)
    known.set(review.identifier, {
      objectKind: 'experiment',
      ref: review.identifier,
    })
  for (const material of input.materials)
    if (material.identifier)
      known.set(material.identifier, {
        objectKind: 'material',
        ref: material.identifier,
      })
  for (const issue of input.datasetIssues)
    known.set(issue.identifier, {
      objectKind: 'dataset',
      ref: issue.identifier,
    })
  for (const project of input.projects)
    if (project.title)
      known.set(project.title, { objectKind: 'project', ref: project.id })

  const names = [...known.keys()].sort((a, b) => b.length - a.length)
  const escaped = names.map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  )
  const owner = input.projects.find((project) =>
    text.toLowerCase().startsWith(project.title.toLowerCase()),
  )
  const patterns = [...escaped.map((name) => `(?<![\\w-])${name}(?![\\w-])`)]
  if (owner) patterns.push('\\b\\d+ experiments?\\b')
  if (patterns.length === 0) return [{ kind: 'text', text }]
  const pattern = new RegExp(patterns.join('|'), 'g')

  const parts: BriefPart[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const found = match[0]
    const start = match.index
    const entity = known.get(found)
    // A project's name at the start of its own bullet is the project link; a
    // count anywhere else in that bullet opens the project's experiments.
    if (!entity && !owner) continue
    if (start > last)
      parts.push({ kind: 'text', text: text.slice(last, start) })
    if (entity) parts.push({ kind: 'object', ...entity, text: found })
    else if (owner)
      parts.push({
        kind: 'route',
        to: `/projects/${encodeURIComponent(owner.id)}/experiments`,
        text: found,
      })
    last = start + found.length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}
