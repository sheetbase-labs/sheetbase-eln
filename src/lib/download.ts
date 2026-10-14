/**
 * Handing a built file to the browser's download UI, in one place.
 *
 * The anchor must be in the document before it is clicked (a detached anchor is
 * ignored), and its blob URL must stay alive past the click's own tick: the
 * browser reads the blob asynchronously, so revoking the URL immediately drops
 * the file in Firefox and some Safari builds with nothing said.
 */

/** How long a download's blob URL stays alive after the click. */
export const BLOB_URL_LIFETIME_MS = 30_000

/**
 * Save `contents` under `filename`. The anchor is attached, clicked, then
 * removed, and the blob URL is released on a short timer so the browser can
 * read the blob first. Throws when the browser cannot take a download, so the
 * caller states the failure rather than the file going missing.
 */
export function downloadTextFile(
  filename: string,
  contents: string | Blob,
  type = 'text/plain',
): void {
  const anchor = document.createElement('a')
  if (!('download' in anchor)) {
    throw new Error('This browser cannot save files.')
  }
  const blob =
    contents instanceof Blob ? contents : new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  } finally {
    anchor.remove()
  }
  window.setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_LIFETIME_MS)
}
