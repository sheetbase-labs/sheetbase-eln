import type { Molecule } from 'openchemlib'
import { app, cellSvg, OCL, pictureSvg, readStructure } from './common'

interface RecordRow {
  id: string
  kind: string
  identifier: string
  title: string
  archived_at: string | null
  custom_fields: Record<string, unknown>
}
interface FieldDef {
  field_name: string
  label: string
  logical_type: string
  lifecycle: string
}
interface Model {
  key: string
  name: string
}
interface Row {
  record: RecordRow
  molecule: Molecule
  parent: Molecule
  mass: number
  logP: number | null
  hbd: number | null
  hba: number | null
  tpsa: number | null
  index: number[]
  similarity: number | null
}
interface Page<T> {
  items: T[]
  nextOffset: number | null
}

// The SAR table: every compound of a registry beside the measurements the lab
// keeps for it. Shade a measurement to see the trend, compare against a
// reference compound, or keep only the compounds that share a core. Reads go
// through the same canonical read the API has, as the person looking at it.
const PAGE_LIMIT = 20
const AUTO_LOAD = 400

const root = app()
root.innerHTML = `
  <div class="sar">
    <div class="row controls">
      <label class="field">Registry<select id="model"></select></label>
      <label class="field">Shade by<select id="measure"><option value="">No measurement</option></select></label>
      <label class="field">Compare with<select id="reference"><option value="">No reference</option></select></label>
      <div class="field">Core to keep
        <span class="row buttons">
          <span id="scaffold-picture" class="picture small"></span>
          <button type="button" id="draw">Draw a core</button>
          <button type="button" id="clear" hidden>Clear</button>
        </span>
      </div>
      <span class="grow"></span>
      <span id="count" class="muted"></span>
    </div>
    <div id="editor" class="editor" hidden>
      <div id="canvas" class="canvas"></div>
      <div class="row buttons">
        <button type="button" id="done" class="primary">Use this core</button>
        <button type="button" id="cancel">Cancel</button>
      </div>
    </div>
    <div id="error" class="err" role="alert"></div>
    <div class="row buttons"><button type="button" id="more" hidden>Load more</button></div>
  </div>`
const $ = <T extends HTMLElement>(id: string) =>
  root.querySelector<T>(`#${id}`)!
const modelBox = $<HTMLSelectElement>('model')
const measureBox = $<HTMLSelectElement>('measure')
const referenceBox = $<HTMLSelectElement>('reference')
const countBox = $('count')
const errorBox = $('error')
const moreButton = $('more')
const editorBox = $('editor')
const scaffoldPicture = $('scaffold-picture')

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
const numberOf = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

let kind = ''
let numeric: FieldDef[] = []
let rows: Row[] = []
let nextOffset: number | null = 0
let hidden = 0
let scaffold = ''
let canvas: InstanceType<typeof OCL.CanvasEditor> | null = null
let generation = 0

function indexOf(molecule: Molecule): number[] {
  const searcher = new OCL.SSSearcherWithIndex()
  return Array.from(searcher.createIndex(molecule))
}

function rowFor(record: RecordRow): Row | null {
  const molfile = Object.values(record.custom_fields).find(
    (value): value is string =>
      typeof value === 'string' && value.includes('M  END'),
  )
  const molecule = molfile ? readStructure(molfile) : null
  if (!molecule) return null
  const parent = molecule.getCompactCopy()
  parent.stripSmallFragments(false)
  parent.ensureHelperArrays(OCL.Molecule.cHelperParities)
  let props: InstanceType<typeof OCL.MoleculeProperties> | null = null
  try {
    props = new OCL.MoleculeProperties(parent)
  } catch {
    props = null
  }
  return {
    record,
    molecule,
    parent,
    mass: Number(parent.getMolecularFormula().relativeWeight.toFixed(1)),
    logP: props ? Number(props.logP.toFixed(2)) : null,
    hbd: props ? props.donorCount : null,
    hba: props ? props.acceptorCount : null,
    tpsa: props ? Number(props.polarSurfaceArea.toFixed(1)) : null,
    index: indexOf(parent),
    similarity: null,
  }
}

async function read<T>(
  resource: string,
  filters: Record<string, unknown>,
  offset = 0,
): Promise<Page<T>> {
  return await sheetbase.host('sheetbase.canonical.read', {
    resource,
    filters,
    limit: PAGE_LIMIT,
    offset,
  })
}

async function loadMore(all: boolean) {
  const mine = generation
  moreButton.hidden = true
  try {
    while (nextOffset !== null) {
      const page = await read<RecordRow>('records', { kind }, nextOffset)
      if (mine !== generation) return
      for (const record of page.items) {
        if (record.archived_at) continue
        const row = rowFor(record)
        if (row) rows.push(row)
        else hidden += 1
      }
      nextOffset = page.nextOffset
      render()
      if (!all && rows.length + hidden >= AUTO_LOAD) break
    }
  } catch (e) {
    errorBox.textContent =
      e instanceof Error ? e.message : 'Could not load the compounds.'
  }
  moreButton.hidden = nextOffset === null
  render()
}

function visibleRows(): Row[] {
  let list = rows
  if (scaffold) {
    const fragment = readStructure(scaffold)
    if (fragment) {
      const query = fragment.getCompactCopy()
      query.setFragment(true)
      query.ensureHelperArrays(OCL.Molecule.cHelperParities)
      const searcher = new OCL.SSSearcher()
      searcher.setFragment(query)
      list = list.filter((row) => {
        searcher.setMolecule(row.parent)
        return searcher.isFragmentInMolecule()
      })
    }
  }
  const reference = rows.find((row) => row.record.id === referenceBox.value)
  for (const row of rows)
    row.similarity = reference
      ? OCL.SSSearcherWithIndex.getSimilarityTanimoto(
          reference.index,
          row.index,
        )
      : null
  return list
}

function valueFor(row: Row, key: string): string | number | null {
  switch (key) {
    case 'identifier':
      return row.record.identifier
    case 'title':
      return row.record.title
    case 'mass':
      return row.mass
    case 'logP':
    case 'hbd':
    case 'hba':
    case 'tpsa':
      return row[key]
    case 'similarity':
      return row.similarity
    default:
      return numberOf(row.record.custom_fields[key.replace(/^field:/, '')])
  }
}

function render() {
  const list = visibleRows()
  const measure = measureBox.value
  const values = measure
    ? list
        .map((row) => numberOf(row.record.custom_fields[measure]))
        .filter((v): v is number => v !== null)
    : []
  const low = Math.min(...values)
  const high = Math.max(...values)
  const withReference = referenceBox.value !== ''
  const columns: { key: string; label: string; num: boolean }[] = [
    { key: 'structure', label: 'Structure', num: false },
    { key: 'identifier', label: 'Number', num: false },
    { key: 'title', label: 'Name', num: false },
    ...numeric.map((f) => ({
      key: `field:${f.field_name}`,
      label: f.label,
      num: true,
    })),
    ...(withReference
      ? [{ key: 'similarity', label: 'Similarity', num: true }]
      : []),
    { key: 'mass', label: 'Mass', num: true },
    { key: 'logP', label: 'logP', num: true },
    { key: 'hbd', label: 'H-bond donors', num: true },
    { key: 'hba', label: 'H-bond acceptors', num: true },
    { key: 'tpsa', label: 'Polar surface', num: true },
  ]
  countBox.textContent = `${list.length} ${list.length === 1 ? 'compound' : 'compounds'}${hidden ? ` · ${hidden} without a structure` : ''}${nextOffset !== null ? ' · more to load' : ''}`
  const empty =
    nextOffset !== null
      ? 'Loading…'
      : rows.length === 0
        ? 'No compounds with a structure here yet.'
        : 'No compound has that core.'
  // Sheetbase draws the table below this screen with its own table.
  sheetbase.table({
    columns: columns.map((c) => ({
      key: c.key,
      label: c.label,
      ...(c.num ? { align: 'right' as const } : {}),
    })),
    rows: list.map((row) => ({
      id: row.record.id,
      cells: Object.fromEntries(
        columns.map((c) => {
          const href = `/records/${row.record.id}`
          if (c.key === 'structure')
            return [c.key, { svg: cellSvg(row.parent, 150, 64) }]
          if (c.key === 'identifier')
            return [c.key, { text: row.record.identifier, href }]
          if (c.key === 'title')
            return [c.key, { text: row.record.title, href }]
          const value = valueFor(row, c.key)
          const shaded =
            measure && c.key === `field:${measure}` && typeof value === 'number'
          return [
            c.key,
            {
              text:
                value === null
                  ? ''
                  : c.key === 'similarity'
                    ? `${Math.round(Number(value) * 100)}%`
                    : String(value),
              sort: value,
              ...(shaded
                ? {
                    shade: high === low ? 0 : (value - low) / (high - low),
                  }
                : {}),
            },
          ]
        }),
      ),
    })),
    sort: { key: 'identifier' },
    empty,
  })
  sheetbase.resize(Math.max(120, document.body.scrollHeight + 24))
}

function fillReference() {
  const keep = referenceBox.value
  referenceBox.innerHTML =
    '<option value="">No reference</option>' +
    rows
      .map(
        (row) =>
          `<option value="${esc(row.record.id)}">${esc(row.record.identifier)} ${esc(row.record.title)}</option>`,
      )
      .join('')
  referenceBox.value = keep
}

async function chooseRegistry(next: string) {
  generation += 1
  kind = next
  rows = []
  hidden = 0
  nextOffset = 0
  scaffold = ''
  scaffoldPicture.innerHTML = ''
  $('clear').hidden = true
  measureBox.value = ''
  errorBox.textContent = ''
  sheetbase.table(null)
  try {
    const defs: FieldDef[] = []
    let offset: number | null = 0
    while (offset !== null) {
      const page: Page<FieldDef> = await read<FieldDef>(
        'record_field_definitions',
        { kind },
        offset,
      )
      defs.push(...page.items)
      offset = page.nextOffset
    }
    numeric = defs.filter(
      (f) =>
        f.lifecycle === 'active' &&
        (f.logical_type === 'decimal' || f.logical_type === 'integer'),
    )
    measureBox.innerHTML =
      '<option value="">No measurement</option>' +
      numeric
        .map(
          (f) =>
            `<option value="${esc(f.field_name)}">${esc(f.label)}</option>`,
        )
        .join('')
  } catch (e) {
    errorBox.textContent =
      e instanceof Error ? e.message : 'Could not load the fields.'
  }
  referenceBox.innerHTML = '<option value="">No reference</option>'
  await loadMore(false)
  fillReference()
}

modelBox.addEventListener('change', () => void chooseRegistry(modelBox.value))
measureBox.addEventListener('change', render)
referenceBox.addEventListener('change', render)
moreButton.addEventListener('click', async () => {
  await loadMore(true)
  fillReference()
})
$('draw').addEventListener('click', () => {
  editorBox.hidden = false
  canvas = new OCL.CanvasEditor($('canvas'), { initialMode: 'molecule' })
  const molecule = scaffold ? readStructure(scaffold) : null
  if (molecule) canvas.setMolecule(molecule)
  sheetbase.resize(1100)
})
function closeEditor() {
  canvas?.destroy()
  canvas = null
  editorBox.hidden = true
}
$('cancel').addEventListener('click', () => {
  closeEditor()
  render()
})
$('done').addEventListener('click', () => {
  const molecule = canvas?.getMolecule()
  closeEditor()
  scaffold = molecule && molecule.getAllAtoms() > 0 ? molecule.toMolfile() : ''
  const shown = scaffold ? readStructure(scaffold) : null
  scaffoldPicture.innerHTML = shown ? pictureSvg(shown, 120, 48) : ''
  $('clear').hidden = !shown
  render()
})
$('clear').addEventListener('click', () => {
  scaffold = ''
  scaffoldPicture.innerHTML = ''
  $('clear').hidden = true
  render()
})

let started = false
sheetbase.onContext(async () => {
  if (started) return
  started = true
  try {
    const models: Model[] = []
    let offset: number | null = 0
    while (offset !== null) {
      const page: Page<Model> = await read<Model>('record_models', {}, offset)
      models.push(...page.items)
      offset = page.nextOffset
    }
    modelBox.innerHTML = models
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => `<option value="${esc(m.key)}">${esc(m.name)}</option>`)
      .join('')
    modelBox.value = models.some((m) => m.key === 'compound')
      ? 'compound'
      : (models[0]?.key ?? '')
    if (modelBox.value) await chooseRegistry(modelBox.value)
  } catch (e) {
    errorBox.textContent =
      e instanceof Error ? e.message : 'Could not load the registries.'
  }
})
