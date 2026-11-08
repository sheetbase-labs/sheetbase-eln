/** Hand a built file to the browser's download UI. */
export function downloadTextFile(
  filename: string,
  contents: string | Blob,
  type = 'text/plain',
): void {
  const blob =
    contents instanceof Blob ? contents : new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
