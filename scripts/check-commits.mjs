/**
 * Pull request check on commit messages, authors, the PR title, body and
 * branch name. See `scripts/lib/commit-rules.mjs` for the rules.
 *
 * Usage:
 *   node scripts/check-commits.mjs [base-ref]        commits in base..HEAD
 *   node scripts/check-commits.mjs --message <file>  one message (commit-msg hook)
 *
 * PR_TITLE, PR_BODY and PR_HEAD, when set, are checked too.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import {
  checkCommit,
  checkPullRequest,
  checkSubject,
} from './lib/commit-rules.mjs'

const problems = []

if (process.argv[2] === '--message') {
  const message = readFileSync(process.argv[3], 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
  const subject = message.split('\n')[0] ?? ''
  // Fixups are fine while working; CI fails them so they are folded in.
  if (!/^(fixup|squash|amend)! /.test(subject))
    problems.push(...checkSubject(subject))
} else {
  const base = process.argv[2] ?? 'origin/main'
  const SEP = '\x1e'
  const raw = execFileSync(
    'git',
    [
      'log',
      `--format=%H%x1f%P%x1f%an <%ae>%x1f%cn <%ce>%x1f%B${SEP}`,
      `${base}..HEAD`,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  for (const entry of raw.split(SEP)) {
    if (!entry.trim()) continue
    const [sha, parents, author, committer, message] = entry
      .replace(/^\n/, '')
      .split('\x1f')
    for (const problem of checkCommit({
      message,
      author,
      committer,
      parents: parents.trim().split(' ').filter(Boolean).length,
    }))
      problems.push(`${sha.slice(0, 8)}: ${problem}`)
  }
}

if (process.env.PR_TITLE !== undefined)
  problems.push(
    ...checkPullRequest({
      title: process.env.PR_TITLE,
      body: process.env.PR_BODY ?? '',
      head: process.env.PR_HEAD ?? '',
    }),
  )

if (problems.length) {
  console.error(problems.join('\n'))
  console.error(
    '\nCommits are made as iamgp with Conventional Commit subjects and no assistant credit.' +
      '\nFix a branch with: git rebase -i origin/main (reword), then git push --force-with-lease.',
  )
  process.exit(1)
}
console.log('Commit rules: all good')
