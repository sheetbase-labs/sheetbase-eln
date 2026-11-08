import { app, pictureSvg, readStructure } from './common'

interface Lot {
  id: string
  identifier: string
  title: string
  created_at: string
}
interface Described {
  formula: string
  mass: number
  parent_smiles: string
  salts: string[]
}
interface RecordRow {
  identifier: string
  custom_fields: Record<string, unknown>
}

// What a compound entry shows: the structure as drawn and its parent, the
// formula and mass, the salts set aside, and its lots. Everything goes through
// the same operations and lab actions the API and the assistant use, as the
// person looking at the screen.
const root = app()
root.innerHTML = `
  <div class="col">
    <h3>Structure</h3>
    <div id="structure" class="muted">Loading…</div>
    <div id="lots-section">
      <h3>Lots <span id="count" class="muted"></span></h3>
      <div id="list" class="muted">Loading…</div>
      <div class="row buttons">
        <input type="text" id="lot-name" placeholder="Lot name (optional)" aria-label="Lot name" />
        <button type="button" id="add" class="primary">Add a lot</button>
      </div>
    </div>
    <div id="error" class="err" role="alert"></div>
  </div>`
const $ = <T extends HTMLElement>(id: string) =>
  root.querySelector<T>(`#${id}`)!
const structureBox = $('structure')
const lotsSection = $('lots-section')
const list = $('list')
const error = $('error')
const nameBox = $<HTMLInputElement>('lot-name')
let compoundId = ''

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
const message = (e: unknown, fallback: string) =>
  e instanceof Error ? e.message : fallback

function figure(label: string, svg: string): string {
  return `<figure class="fig"><div class="picture" role="img" aria-label="${esc(label)}">${svg}</div><figcaption class="muted">${esc(label)}</figcaption></figure>`
}

async function loadStructure() {
  const found = await sheetbase.host('sheetbase.canonical.read', {
    resource: 'records',
    filters: { id: compoundId },
  })
  const fields = found.items[0]?.custom_fields ?? {}
  const molfile = Object.values(fields).find(
    (value): value is string =>
      typeof value === 'string' && value.includes('M  END'),
  )
  const molecule = molfile ? readStructure(molfile) : null
  if (!molfile || !molecule) {
    structureBox.textContent = 'No structure yet.'
    return
  }
  const described = await sheetbase.call<Described>('describe', {
    structure: molfile,
  })
  const parent = described.salts.length
    ? readStructure(described.parent_smiles)
    : null
  structureBox.className = ''
  structureBox.innerHTML = `
    <div class="row">
      ${figure('As drawn', pictureSvg(molecule, 260, 170))}
      ${parent ? figure('Parent', pictureSvg(parent, 200, 130)) : ''}
      <div class="col facts">
        <strong>${esc(described.formula)} · ${described.mass} g/mol</strong>
        ${described.salts.length ? `<span class="muted">Set aside: ${esc(described.salts.join(', '))}</span>` : ''}
      </div>
    </div>`
}

async function loadLots() {
  try {
    const lots = await sheetbase.host('sheetbase.lab.act', {
      action: 'list_compound_lots',
      arguments: { p_compound_id: compoundId },
    })
    $('count').textContent = String(lots.length)
    list.className = ''
    list.innerHTML = lots.length
      ? `<table><thead><tr><th>Lot</th><th>Name</th><th>Added</th></tr></thead><tbody>${lots
          .map(
            (lot) =>
              `<tr><td><a href="#" data-id="${esc(lot.id)}">${esc(lot.identifier)}</a></td><td><a href="#" data-id="${esc(lot.id)}">${esc(lot.title)}</a></td><td>${esc(lot.created_at.slice(0, 10))}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '<span class="muted">No lots yet.</span>'
    list.querySelectorAll<HTMLAnchorElement>('a[data-id]').forEach((a) =>
      a.addEventListener('click', (event) => {
        event.preventDefault()
        sheetbase.navigate(`/records/${a.dataset.id}`)
      }),
    )
  } catch {
    // A registry that keeps no lots has nothing to list.
    lotsSection.hidden = true
  }
}

async function load() {
  if (!compoundId) return
  error.textContent = ''
  await Promise.all([
    loadStructure().catch((e) => {
      structureBox.textContent = message(e, 'Could not load the structure.')
    }),
    loadLots(),
  ])
  sheetbase.resize(document.body.scrollHeight + 24)
}

$('add').addEventListener('click', async () => {
  try {
    await sheetbase.host('sheetbase.lab.act', {
      action: 'add_compound_lot',
      arguments: {
        p_compound_id: compoundId,
        ...(nameBox.value.trim() ? { p_title: nameBox.value.trim() } : {}),
      },
    })
    nameBox.value = ''
    await loadLots()
    sheetbase.resize(document.body.scrollHeight + 24)
  } catch (e) {
    error.textContent = message(e, 'Could not add the lot.')
  }
})

sheetbase.onContext<{ recordId?: string }>((context) => {
  compoundId = context.recordId ?? ''
  void load()
})
