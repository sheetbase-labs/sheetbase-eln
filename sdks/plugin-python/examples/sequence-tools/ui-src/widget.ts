import { analyse, app, clean } from './common'

// A card on Home.
const root = app()
root.innerHTML = `
  <div class="col">
    <input id="seq" type="text" spellcheck="false" placeholder="Paste a sequence" aria-label="Sequence" />
    <div id="out" class="stats muted">GC content appears here.</div>
    <div><a id="more" href="#" class="muted">Open the library</a></div>
  </div>`
const box = root.querySelector<HTMLInputElement>('#seq')!
const out = root.querySelector<HTMLElement>('#out')!
box.addEventListener('change', async () => {
  const sequence = clean(box.value)
  if (!sequence) return
  try {
    const result = await analyse(sequence)
    out.textContent = `${result.length} bases · ${result.gc}% GC`
  } catch (error) {
    out.textContent = (error as Error).message
  }
})
root.querySelector('#more')!.addEventListener('click', (event) => {
  event.preventDefault()
  sheetbase.navigate('/plugins/sequence-tools/library')
})
