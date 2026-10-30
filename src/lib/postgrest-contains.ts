/**
 * A search term as a PostgREST `ilike` contains-pattern, already quoted for use
 * inside an `or=(...)` list. The term's own `%`, `_` and quote characters are
 * escaped so a person searching "50%" or `a,b` matches those characters
 * literally. Percent-encode the result before putting it in a URL.
 */
export function containsPattern(term: string): string {
  const likeEscaped = term.replace(/[\\%_]/g, (c) => `\\${c}`)
  const quoted = likeEscaped.replace(/[\\"]/g, (c) => `\\${c}`)
  return `"*${quoted}*"`
}
