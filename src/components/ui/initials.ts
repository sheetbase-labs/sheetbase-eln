/**
 * The one initials rule in the app: the first letter of the first two words,
 * uppercased — `Gareth Price` → `GP`, `Cher` → `C`. It lives here so every
 * avatar derives initials the same way and one person cannot read as `GA` on
 * one surface and `GP` on the next.
 */
export function initialsFromName(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')

  return initials || '?'
}
