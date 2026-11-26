/** Words on the record type cards, read as `t('features.models.…')`. */
const done = (apply: string, applying: string, applied: string) => ({
  apply,
  applying,
  applied,
})

export const copy = {
  cards: {
    addRegistry: done('Add registry', 'Adding…', 'Registry added'),
    addRequestForm: done('Add request form', 'Adding…', 'Request form added'),
    addRecordType: done('Add record type', 'Adding…', 'Record type added'),
    addSupplierType: done(
      'Add Supplier type',
      'Adding…',
      'Supplier type added',
    ),
    setRegistry: done('Save', 'Saving…', 'Saved'),
    setLotType: done('Save', 'Saving…', 'Saved'),
    setSameness: done('Save rule', 'Saving…', 'Rule saved'),
    setIncidentLog: done('Save', 'Saving…', 'Saved'),
    setRequestForm: done('Save', 'Saving…', 'Saved'),
    setSupplierList: done('Save', 'Saving…', 'Saved'),
    addDraftField: done('Add draft field', 'Adding…', 'Draft field added'),
    addField: done('Add field', 'Adding…', 'Field added'),
    switchOn: done('Switch on', 'Switching on…', 'Switched on'),
    changeField: done('Save changes', 'Saving…', 'Saved'),
    setMeaning: done('Save', 'Saving…', 'Saved'),
    changeFieldInUse: done('Make the change', 'Changing…', 'Changed'),
    setPluginType: done('Save', 'Saving…', 'Saved'),
    makeShared: done('Make a shared field', 'Making…', 'Field made'),
    changeType: done('Change type', 'Changing…', 'Type changed'),
    removeParent: done('Remove parent', 'Removing…', 'Parent removed'),
  },
} as const
