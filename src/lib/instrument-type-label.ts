const KNOWN: Record<string, string> = {
  qpcr: 'qPCR',
  hplc: 'HPLC',
  lcms: 'LC-MS',
  plate_reader: 'Plate reader',
  ph_meter: 'pH meter',
}

/** An instrument's type the way a scientist writes it ("qPCR", "Plate reader"). */
export function instrumentTypeLabel(type: string): string {
  const known = KNOWN[type.toLowerCase()]
  if (known) return known
  const words = type.replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : type
}
