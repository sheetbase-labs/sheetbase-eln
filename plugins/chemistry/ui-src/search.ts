import { app, molfileOf, OCL, pictureSvg, readStructure } from './common'

// A page: draw a structure, then go to the search with it as a query.
const root = app()
root.innerHTML = `
  <div class="col">
    <div id="canvas" class="canvas"></div>
    <div class="row buttons">
      <button type="button" id="sub" class="primary">Contains this</button>
      <button type="button" id="sim">Looks like this</button>
    </div>
    <div class="muted">Draw part of a structure (or a whole one) and find the compounds in your registries that contain it or look like it.</div>
    <div id="error" class="err" role="alert"></div>
  </div>`
const canvas = new OCL.CanvasEditor(
  root.querySelector<HTMLElement>('#canvas')!,
  {
    initialMode: 'molecule',
  },
)
void pictureSvg
const error = root.querySelector<HTMLElement>('#error')!

function go(mode: 'sub' | 'sim') {
  const molecule = canvas.getMolecule()
  if (molecule.getAllAtoms() === 0 || !readStructure(molecule.toMolfile())) {
    error.textContent = 'Draw a structure first.'
    return
  }
  error.textContent = ''
  const molfile = molfileOf(molecule.toMolfile())!
  sheetbase.navigate(`/search?q=${encodeURIComponent(`${mode}:${molfile}`)}`)
}
root.querySelector('#sub')!.addEventListener('click', () => go('sub'))
root.querySelector('#sim')!.addEventListener('click', () => go('sim'))
sheetbase.onContext(() => sheetbase.resize(620))
