import { app, clean, gcContent, isDna, ringSvg } from './common'

// A form field's input: shows the GC content and a map as the person types.
const root = app()
root.innerHTML = `
  <div class="row">
    <div class="col">
      <textarea id="seq" rows="3" spellcheck="false" aria-label="DNA sequence"></textarea>
      <div id="note" class="muted stats"></div>
    </div>
    <div id="ring" class="ring"></div>
  </div>`
const box = root.querySelector<HTMLTextAreaElement>('#seq')!
const note = root.querySelector<HTMLElement>('#note')!
const ring = root.querySelector<HTMLElement>('#ring')!

function show() {
  const sequence = clean(box.value)
  if (!sequence) {
    note.textContent = 'Type or paste the sequence.'
    ring.innerHTML = ''
  } else if (!isDna(sequence)) {
    note.innerHTML = '<span class="err">Use the letters A, C, G, T or N.</span>'
    ring.innerHTML = ''
  } else {
    note.textContent = `${sequence.length} bases · ${gcContent(sequence).toFixed(1)}% GC`
    ring.innerHTML = ringSvg(sequence, 96, 32)
  }
}

sheetbase.onContext<{ value: string }>((context) => {
  if (document.activeElement !== box) box.value = context.value ?? ''
  show()
})
box.addEventListener('input', () => {
  show()
  sheetbase.setValue(clean(box.value))
})
