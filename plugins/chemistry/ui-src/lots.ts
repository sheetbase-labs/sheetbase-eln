import { app } from './common'

interface Lot {
  id: string
  identifier: string
  title: string
  created_at: string
}

// The lots of a compound: each batch made of it. Uses the same lab actions the
// API and the assistant have, as the person looking at the screen.
const root = app()
root.innerHTML = `
  <div class="col">
    <div id="list" class="muted">Loading…</div>
    <div class="row buttons">
      <button type="button" id="add" class="primary">Add a lot</button>
    </div>
    <div id="error" class="err" role="alert"></div>
  </div>`
const list = root.querySelector<HTMLElement>('#list')!
const error = root.querySelector<HTMLElement>('#error')!
let compoundId = ''

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

async function load() {
  if (!compoundId) return
  try {
    const lots = (await sheetbase.host('sheetbase.lab.act', {
      action: 'list_compound_lots',
      arguments: { p_compound_id: compoundId },
    })) as Lot[]
    list.innerHTML = lots.length
      ? `<table><thead><tr><th>Lot</th><th>Name</th><th>Made</th></tr></thead><tbody>${lots
          .map(
            (lot) =>
              `<tr><td><a href="#" data-id="${esc(lot.id)}">${esc(lot.identifier)}</a></td><td>${esc(lot.title)}</td><td>${esc(lot.created_at.slice(0, 10))}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : 'No lots yet.'
    list.querySelectorAll<HTMLAnchorElement>('a[data-id]').forEach((a) =>
      a.addEventListener('click', (event) => {
        event.preventDefault()
        sheetbase.navigate(`/records/${a.dataset.id}`)
      }),
    )
    error.textContent = ''
  } catch (e) {
    error.textContent = e instanceof Error ? e.message : 'Could not load.'
  }
  sheetbase.resize(document.body.scrollHeight + 24)
}

root.querySelector('#add')!.addEventListener('click', async () => {
  try {
    await sheetbase.host('sheetbase.lab.act', {
      action: 'add_compound_lot',
      arguments: { p_compound_id: compoundId },
    })
    await load()
  } catch (e) {
    error.textContent = e instanceof Error ? e.message : 'Could not add.'
  }
})

sheetbase.onContext<{ recordId?: string }>((context) => {
  compoundId = context.recordId ?? ''
  void load()
})
