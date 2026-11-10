import { toast } from '../ui/kit'
import { t } from '#/copy'
import { isSequenceFileName, parseSequenceFile } from '#/lib/sequence'
import type { WorkbenchProps } from './shared'

/**
 * Importing replaces the whole sequence: the file's name (when the block has
 * none), its molecule, topology, bases and features. A file that will not parse
 * says why and leaves the block alone.
 */
export function importSequenceText(
  content: string,
  edit: WorkbenchProps['edit'],
): void {
  try {
    const [first] = parseSequenceFile(content)
    edit((d) => ({
      ...d,
      name: d.name || first.name,
      molecule: first.molecule,
      topology: first.topology,
      residues: first.residues,
      features: first.features,
    }))
    toast(t('molbio.edit.imported', { name: first.name }))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

/** The same, for a file the person chose from their machine. */
export async function importSequenceFile(
  file: File,
  edit: WorkbenchProps['edit'],
): Promise<void> {
  if (!isSequenceFileName(file.name)) {
    toast.error(t('sequences.notSequence', { name: file.name }))

    return
  }

  importSequenceText(await file.text(), edit)
}
