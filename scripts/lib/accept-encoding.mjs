/**
 * Whether an Accept-Encoding header allows `token` (for example "br"). Each
 * entry is `name` or `name;q=weight`; a weight of 0 refuses it, and `*`
 * stands for any encoding not named. Missing or empty means identity only.
 */
export function acceptsEncoding(header, token) {
  if (!header) return false
  let wildcard = null

  for (const entry of String(header).split(',')) {
    const [rawName, ...params] = entry.trim().split(';')
    const name = rawName.trim().toLowerCase()

    if (!name) continue

    const q = params
      .map((param) => param.trim().match(/^q=([\d.]+)$/i))
      .find(Boolean)

    const weight = q ? Number(q[1]) : 1

    if (name === token) return weight > 0

    if (name === '*') wildcard = weight > 0
  }

  return wildcard ?? false
}
