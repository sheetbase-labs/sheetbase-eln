/**
 * Rules for commit messages, PR titles, PR bodies and branch names.
 *
 * Commits are made as Gareth with Conventional Commit subjects and no
 * assistant credit: no Co-Authored-By or session trailers, no "Generated
 * with" lines, no attribution blocks in PR bodies and no `claude/` branches.
 * Used by `scripts/check-commits.mjs` (CI) and `.githooks/commit-msg`.
 */

export const CONVENTIONAL_TYPES = [
  'feat',
  'fix',
  'refactor',
  'perf',
  'test',
  'docs',
  'style',
  'build',
  'ci',
  'chore',
  'revert',
]

export const CONVENTIONAL_SUBJECT = new RegExp(
  `^(${CONVENTIONAL_TYPES.join('|')})(\\([a-z0-9][a-z0-9._/-]*\\))?!?: \\S`,
)

/** Lines that credit an assistant, in a commit message or a PR body. */
const ATTRIBUTION_LINES = [
  /^\s*co-authored-by:.*\b(claude|anthropic|noreply@anthropic\.com)\b/i,
  /^\s*claude-session:/i,
  /generated (with|by) \[?claude( code)?\]?/i,
  /claude\.(ai|com)\/code/i,
  /claude-projects-attribution/i,
  /^\s*_?requested by \*\*/i,
]

const ASSISTANT_IDENTITY = /\b(claude|anthropic)\b/i

export const isAttributionLine = (line) =>
  ATTRIBUTION_LINES.some((pattern) => pattern.test(line))

/** Drops attribution lines and the blank lines left trailing behind them. */
export function stripAttribution(message) {
  const kept = message.split('\n').filter((line) => !isAttributionLine(line))
  while (kept.length && /^\s*(---)?\s*$/.test(kept[kept.length - 1])) kept.pop()
  return kept.length ? `${kept.join('\n')}\n` : ''
}

export function checkSubject(subject, what = 'Subject') {
  if (CONVENTIONAL_SUBJECT.test(subject)) return []
  return [
    `${what} is not a Conventional Commit ("type(scope): summary", type one of ${CONVENTIONAL_TYPES.join(', ')}): ${subject}`,
  ]
}

export function checkAttribution(text, what) {
  return text
    .split('\n')
    .filter(isAttributionLine)
    .map((line) => `${what} credits an assistant: ${line.trim()}`)
}

/**
 * One commit: its full message, author and committer, and parent count.
 * Fixup commits fail here so they are folded in before merge.
 */
export function checkCommit({
  message,
  author = '',
  committer = '',
  parents = 1,
}) {
  const subject = message.split('\n')[0] ?? ''
  const problems = []
  if (parents > 1) problems.push('Merge commit: rebase on main instead')
  problems.push(...checkSubject(subject))
  problems.push(...checkAttribution(message, 'Message'))
  if (ASSISTANT_IDENTITY.test(author))
    problems.push(`Author is an assistant: ${author}`)
  if (ASSISTANT_IDENTITY.test(committer))
    problems.push(`Committer is an assistant: ${committer}`)
  return problems
}

export function checkPullRequest({ title = '', body = '', head = '' }) {
  const problems = [
    ...checkSubject(title, 'PR title'),
    ...checkAttribution(body, 'PR body'),
  ]
  if (/^claude\//i.test(head))
    problems.push(
      `Branch name starts with claude/: ${head} (use feat/, fix/ ...)`,
    )
  return problems
}
