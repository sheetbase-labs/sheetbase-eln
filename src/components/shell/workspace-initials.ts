/** Up to two initials for a workspace name: "Process Development" → "PD". */
export function workspaceInitials(name: string): string {
  const words = name
    .trim()
    .split(/[\s\-_/]+/)
    .filter(Boolean)

  const letters =
    words.length > 1
      ? [words[0], words[words.length - 1]].map((word) => Array.from(word)[0])
      : Array.from(words[0] ?? '').slice(0, 2)

  return letters.join('').toUpperCase()
}
