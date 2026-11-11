/**
 * Safety bounds on what a plugin may hand the server. None is a rule about what
 * plugins may do: each only keeps a broken or hostile package from exhausting
 * the machine, and an install changes any of them with an environment variable.
 * Set it to `0` (or `off`) to remove that bound.
 */
export function pluginLimit(name: string, fallback: number): number {
  const raw =
    typeof process === 'undefined' ? undefined : process.env[name]?.trim()

  if (raw === undefined || raw === '') return fallback

  if (raw === '0' || raw.toLowerCase() === 'off')
    return Number.POSITIVE_INFINITY
  const value = Number(raw)

  return Number.isFinite(value) && value > 0 ? value : fallback
}
