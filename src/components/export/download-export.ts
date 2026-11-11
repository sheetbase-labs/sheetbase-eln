/**
 * Start a download from an export endpoint. Navigation triggers it through
 * content-disposition, so the page stays where it is.
 */
export function downloadExport(
  path: string,
  format: string,
  onDone?: () => void,
): void {
  const frame = document.createElement('iframe')
  frame.style.display = 'none'
  frame.src = `${path}?format=${encodeURIComponent(format)}`
  frame.addEventListener('load', () => onDone?.())
  document.body.appendChild(frame)
  window.setTimeout(() => {
    frame.remove()
    onDone?.()
  }, 30_000)
}
