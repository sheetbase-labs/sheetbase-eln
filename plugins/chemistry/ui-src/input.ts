import { app, facts, molfileOf, OCL, pictureSvg, readStructure } from './common'

// A structure field's input: a picture, a drawing tool, and a box for SMILES.
const root = app()
root.innerHTML = `
  <div class="col">
    <div id="picture" class="picture" role="img" aria-label="Structure"></div>
    <div id="note" class="muted stats"></div>
    <div class="row buttons">
      <button type="button" id="draw">Draw</button>
      <button type="button" id="remove" hidden>Remove</button>
    </div>
    <div class="row">
      <input type="text" id="smiles" placeholder="Or paste a SMILES line and press Enter" aria-label="SMILES" />
      <button type="button" id="use">Use SMILES</button>
    </div>
    <div id="error" class="err" role="alert"></div>
    <div id="editor" class="editor" hidden>
      <div id="canvas" class="canvas"></div>
      <div class="row buttons">
        <button type="button" id="done" class="primary">Use drawing</button>
        <button type="button" id="cancel">Cancel</button>
      </div>
    </div>
  </div>`
const $ = <T extends HTMLElement>(id: string) =>
  root.querySelector<T>(`#${id}`)!
const picture = $('picture')
const note = $('note')
const error = $('error')
const editorBox = $('editor')
const canvasHost = $('canvas')
const drawButton = $<HTMLButtonElement>('draw')
const removeButton = $<HTMLButtonElement>('remove')
const smilesBox = $<HTMLInputElement>('smiles')

let value = ''
let canvas: InstanceType<typeof OCL.CanvasEditor> | null = null

function show() {
  const molecule = readStructure(value)
  if (!molecule) {
    picture.innerHTML = ''
    note.textContent = 'No structure yet.'
  } else {
    picture.innerHTML = pictureSvg(molecule, 360, 160)
    const { formula, mass } = facts(molecule)
    note.textContent = `${formula} · ${mass} g/mol`
  }
  drawButton.textContent = molecule ? 'Change' : 'Draw'
  removeButton.hidden = !molecule
  sheetbase.resize(editorBox.hidden ? document.body.scrollHeight : 520)
}

function take(text: string) {
  if (!text.trim()) {
    value = ''
    error.textContent = ''
  } else {
    const molfile = molfileOf(text)
    if (!molfile) {
      error.textContent = 'That could not be read as a structure.'
      return
    }
    error.textContent = ''
    value = molfile
  }
  sheetbase.setValue(value)
  show()
}

function closeEditor() {
  canvas?.destroy()
  canvas = null
  editorBox.hidden = true
  show()
}

drawButton.addEventListener('click', () => {
  editorBox.hidden = false
  canvas = new OCL.CanvasEditor(canvasHost, { initialMode: 'molecule' })
  const molecule = readStructure(value)
  if (molecule) canvas.setMolecule(molecule)
  sheetbase.resize(560)
})
$('done').addEventListener('click', () => {
  const molecule = canvas?.getMolecule()
  closeEditor()
  if (molecule) take(molecule.getAllAtoms() === 0 ? '' : molecule.toMolfile())
})
$('cancel').addEventListener('click', closeEditor)
removeButton.addEventListener('click', () => take(''))
$('use').addEventListener('click', () => {
  take(smilesBox.value)
  smilesBox.value = ''
})
smilesBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    take(smilesBox.value)
    smilesBox.value = ''
  }
})

sheetbase.onContext<{ value: string }>((context) => {
  value = context.value ?? ''
  if (editorBox.hidden) show()
})
