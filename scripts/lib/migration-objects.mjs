/**
 * The database objects a migration's SQL touches, by name.
 *
 * Used by the "Migration order" check to tell a harmless late merge (two
 * migrations about different tables) from one that matters (two migrations
 * that alter the same table, function or policy, where order decides the end
 * state). It reads names after the usual DDL and DML keywords; it is
 * deliberately generous, because a false overlap only asks a person to
 * rename a file, while a miss could apply two changes to one object in a
 * different order on a fresh database than on an existing one.
 */

const NAME = String.raw`(?:"?[a-zA-Z_][\w$]*"?\.)?"?([a-zA-Z_][\w$]*)"?`

const PATTERNS = [
  new RegExp(
    String.raw`\b(?:create(?:\s+or\s+replace)?|alter|drop|truncate)\s+(?:temp(?:orary)?\s+|unlogged\s+|recursive\s+)?(?:table|materialized\s+view|view|function|procedure|type|sequence|domain|extension|schema)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?${NAME}`,
    'gi',
  ),
  new RegExp(
    String.raw`\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?${NAME}`,
    'gi',
  ),
  new RegExp(
    String.raw`\b(?:policy|trigger|rule)\s+${NAME}\s+on\s+${NAME}`,
    'gi',
  ),
  new RegExp(
    String.raw`\bdrop\s+(?:policy|trigger|rule|index)\s+(?:if\s+exists\s+)?${NAME}`,
    'gi',
  ),
  new RegExp(String.raw`\binsert\s+into\s+${NAME}`, 'gi'),
  new RegExp(String.raw`\bdelete\s+from\s+${NAME}`, 'gi'),
  new RegExp(String.raw`(?:^|;)\s*update\s+(?:only\s+)?${NAME}`, 'gim'),
  new RegExp(
    String.raw`\bcomment\s+on\s+(?:table|view|function)\s+${NAME}`,
    'gi',
  ),
  new RegExp(
    String.raw`\b(?:grant|revoke)\b[^;]*?\bon\s+(?:table\s+|function\s+|sequence\s+)?(?:all\s+\w+\s+in\s+schema\s+)?${NAME}`,
    'gi',
  ),
  new RegExp(String.raw`\breferences\s+${NAME}`, 'gi'),
]

const SKIP = new Set(['if', 'only', 'public', 'api', 'on', 'to', 'from'])

/** Lower-case names of the objects `sql` mentions. */
export function migrationObjects(sql) {
  const text = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
  const found = new Set()

  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      for (const name of match.slice(1)) {
        if (name && !SKIP.has(name.toLowerCase())) found.add(name.toLowerCase())
      }
    }
  }

  return found
}

/** The names two sets of objects share. */
export function sharedObjects(a, b) {
  return [...a]
    .filter((name) => b.has(name))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}
