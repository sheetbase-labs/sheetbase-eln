/**
 * Parse a URL a seed step requires.
 *
 * Seed steps run once against a live database, so a malformed value must stop
 * the run with a message that names the setting instead of a bare `TypeError`.
 */
export function seedUrl(raw: string, name: string): URL {
  if (!URL.canParse(raw)) {
    throw new Error(`${name} must be an absolute URL`)
  }

  return new URL(raw)
}
