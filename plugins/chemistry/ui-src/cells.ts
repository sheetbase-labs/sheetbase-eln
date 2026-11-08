import { OCL, pictureSvg, readStructure } from './common'

// A table cell renderer: each stored structure drawn small.
void OCL
sheetbase.onRender((cells) =>
  cells.map(({ key, value }) => {
    const molecule = readStructure(String(value ?? ''))
    if (!molecule)
      return { key, text: value ? 'Unreadable' : '', tone: 'warning' as const }
    return { key, svg: pictureSvg(molecule, 160, 64) }
  }),
)
