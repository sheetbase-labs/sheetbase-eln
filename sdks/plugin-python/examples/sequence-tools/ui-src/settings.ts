import { app } from './common'

// A settings page. What it keeps lives in this browser (setState).
interface State { windows: number }
const root = app()
root.innerHTML = `
  <div class="col" style="max-width:360px">
    <label for="windows">Windows around the ring</label>
    <select id="windows">
      <option value="24">24</option>
      <option value="48">48</option>
      <option value="96">96</option>
    </select>
    <div class="muted">Kept in this browser, for you.</div>
  </div>`
const select = root.querySelector<HTMLSelectElement>('#windows')!
sheetbase.onContext<Record<string, unknown>, State>((_context, state) => {
  select.value = String(state?.windows ?? 48)
})
select.addEventListener('change', () => {
  sheetbase.setState({ windows: Number(select.value) } satisfies State)
  sheetbase.notify('Saved', 'success')
})
