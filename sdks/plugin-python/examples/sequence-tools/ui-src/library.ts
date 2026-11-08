import { analyse, app, clean, ringSvg, stats } from './common'
import type { Analysis } from './common'

// A page in the sidebar. It keeps nothing: it asks the plugin's own operation.
const root = app()
root.innerHTML = `
  <div class="row">
    <div class="col">
      <label for="seq">Paste a DNA sequence</label>
      <textarea id="seq" rows="8" spellcheck="false"></textarea>
      <button id="go" class="primary">Analyse</button>
      <div id="note" class="muted"></div>
    </div>
    <div class="col"><div id="ring" class="ring"></div><div id="stats" class="stats"></div></div>
  </div>`
const box = root.querySelector<HTMLTextAreaElement>('#seq')!
const go = root.querySelector<HTMLButtonElement>('#go')!
const note = root.querySelector<HTMLElement>('#note')!
const ring = root.querySelector<HTMLElement>('#ring')!
const out = root.querySelector<HTMLElement>('#stats')!

go.addEventListener('click', async () => {
  const sequence = clean(box.value)
  go.disabled = true
  note.textContent = 'Working…'
  try {
    const result: Analysis = await analyse(sequence)
    ring.innerHTML = ringSvg(sequence, 220)
    out.textContent = stats(result)
    note.textContent = ''
  } catch (error) {
    note.innerHTML = `<span class="err">${(error as Error).message}</span>`
    ring.innerHTML = ''
    out.textContent = ''
  } finally {
    go.disabled = false
  }
})
