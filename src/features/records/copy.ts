/** Words on the record cards, read as `t('features.records.…')`. */
export const copy = {
  cards: {
    create: {
      apply: 'Add record',
      applying: 'Adding…',
      applied: 'Record added',
    },
    archive: { apply: 'Archive', applying: 'Archiving…', applied: 'Archived' },
    restore: { apply: 'Restore', applying: 'Restoring…', applied: 'Restored' },
    link: { apply: 'Link records', applying: 'Linking…', applied: 'Linked' },
    stock: {
      apply: 'Record stock',
      applying: 'Recording…',
      applied: 'Stock recorded',
    },
    edit: { apply: 'Save changes', applying: 'Saving…', applied: 'Saved' },
    duplicate: {
      apply: 'Make a copy',
      applying: 'Copying…',
      applied: 'Copied',
    },
    addLot: { apply: 'Add lot', applying: 'Adding…', applied: 'Lot added' },
  },
} as const
