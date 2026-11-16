/** Lab files copy, read as `t('features.labFiles.…')`. */
export const copy = {
  cards: {
    plateFromFile: {
      apply: 'Make plate run',
      applying: 'Making…',
      applied: 'Plate run made',
    },
  },
  attach: {
    button: 'Attach a file',
    reading: 'Reading {name}…',
    remove: 'Remove {name}',
    unreadable: 'That file could not be read.',
    tooBig: 'It is too big to read (25 MB at most).',
    tooMany: 'You can attach up to {count} files to a chat.',
    failed: '{name}: {message}',
    hint: 'Plate reader exports, gel photos, vendor PDFs',
    defaultQuestion:
      'Read the attached file. Tell me what is in it and what I could do with it in the lab.',
    dropHere: 'Drop files to attach',
    image: 'Picture',
    table: 'Spreadsheet',
    document: 'Document',
    attached: 'Attached files',
    pictureNote: 'The assistant looks at the picture; it cannot measure bands.',
  },
} as const
