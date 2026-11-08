import { app, clean, gcContent, isDna, ringSvg } from './common'

// A notebook block: the sequence is kept with the block (setState).
interface State { sequence: string }

const root = app()
root.innerHTML = `
  <div class="row">
    <div class="col">
      <label for="seq">Sequence</label>
      <textarea id="seq" rows="4" spellcheck="false" placeholder="ATGGCC…"></textarea>
      <div id="note" class="muted stats"></div>
    </div>
    <div id="ring" class="ring"></div>
  </div>`
const box = root.querySelector<HTMLTextAreaElement>('#seq')!
const note = root.querySelector<HTMLElement>('#note')!
const ring = root.querySelector<HTMLElement>('#ring')!

function show(text: string) {
  const sequence = clean(text)
  if (!sequence) {
    note.textContent = 'Paste or type a sequence.'
    ring.innerHTML = ''
  } else if (!isDna(sequence)) {
    note.innerHTML = '<span class="err">Use the letters A, C, G, T or N.</span>'
    ring.innerHTML = ''
  } else {
    note.textContent = `${sequence.length} bases · ${gcContent(sequence).toFixed(1)}% GC`
    ring.innerHTML = ringSvg(sequence)
  }
  return sequence
}

sheetbase.onContext<Record<string, unknown>, State>((_context, state) => {
  // Don't overwrite what is being typed with the echo of the last save.
  if (document.activeElement !== box) box.value = state?.sequence ?? ''
  show(box.value)
})
box.addEventListener('input', () => {
  sheetbase.setState({ sequence: show(box.value) } satisfies State)
})
