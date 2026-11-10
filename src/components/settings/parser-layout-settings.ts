import type { ParserLayout } from '#/lib/import/parser-layout'

/** Drops options that say nothing, so a stored layout holds only what was chosen. */
export function tidyLayout(layout: ParserLayout): ParserLayout {
  const out: ParserLayout = {}

  if (layout.delimiter && layout.delimiter !== 'auto')
    out.delimiter = layout.delimiter

  if (layout.headerStartsWith?.trim())
    out.headerStartsWith = layout.headerStartsWith.trim()
  else if (layout.headerLine) out.headerLine = layout.headerLine

  if (layout.readDetails) out.readDetails = true
  const ignore = (layout.ignoreLines ?? []).filter(Boolean)

  if (ignore.length) out.ignoreLines = ignore

  if (layout.stopAt?.trim()) out.stopAt = layout.stopAt.trim()

  if (layout.units && layout.units !== 'none') out.units = layout.units

  if (layout.decimalComma) out.decimalComma = true

  if (layout.plateGrid?.valueName.trim())
    out.plateGrid = { valueName: layout.plateGrid.valueName.trim() }

  return out
}
