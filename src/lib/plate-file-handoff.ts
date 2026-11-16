/**
 * Handing a file from one page to the plate run dialog. A file cannot travel in
 * a URL, so the page that has it keeps it here, opens `/plates?new=1`, and the
 * dialog takes it once. Nothing is stored: a reload starts the dialog empty.
 */
let waiting: File | null = null

/** Keep a file for the plate run dialog that is about to open. */
export function stashPlateFile(file: File): void {
  waiting = file
}

/** The file kept for the dialog, once; later calls get nothing. */
export function takePlateFile(): File | null {
  const file = waiting

  waiting = null

  return file
}
