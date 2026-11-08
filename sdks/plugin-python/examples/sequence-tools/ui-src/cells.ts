import { barSvg, clean, gcContent, isDna } from './common'

// A table cell renderer: a GC bar for each sequence on screen.
sheetbase.onRender((cells) =>
  cells.map(({ key, value }) => {
    const sequence = clean(String(value ?? ''))
    if (!isDna(sequence)) return { key, text: String(value ?? ''), tone: 'warning' as const }
    const gc = gcContent(sequence)
    return { key, svg: barSvg(gc), text: `${gc.toFixed(0)}%` }
  }),
)
