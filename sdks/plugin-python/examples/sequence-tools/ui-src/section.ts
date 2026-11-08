import { analyse, app, clean, stats } from './common'

// A report section: the plugin hands back a title and text, which are frozen into the report.
const root = app()
root.innerHTML = `
  <div class="col">
    <label for="name">Sequence name</label>
    <input id="name" type="text" />
    <label for="seq">Sequence</label>
    <textarea id="seq" rows="4" spellcheck="false"></textarea>
    <button id="go">Summarise</button>
    <div id="note" class="muted"></div>
  </div>`
const name = root.querySelector<HTMLInputElement>('#name')!
const box = root.querySelector<HTMLTextAreaElement>('#seq')!
const note = root.querySelector<HTMLElement>('#note')!
root.querySelector('#go')!.addEventListener('click', async () => {
  try {
    const result = await analyse(clean(box.value))
    sheetbase.setSection({
      title: `Sequence summary: ${name.value.trim() || 'unnamed'}`,
      text: stats(result),
    })
    note.textContent = ''
  } catch (error) {
    note.innerHTML = `<span class="err">${(error as Error).message}</span>`
  }
})
