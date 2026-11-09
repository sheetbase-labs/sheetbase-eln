/** Projects copy, read as `t('features.projects.…')`. */
export const copy = {
  cards: {
    updateProject: {
      apply: 'Save project',
      applying: 'Saving…',
      applied: 'Project saved',
    },
    archiveProject: {
      apply: 'Archive project',
      applying: 'Archiving…',
      applied: 'Archived',
    },
    restoreProject: {
      apply: 'Restore project',
      applying: 'Restoring…',
      applied: 'Restored',
    },
    copyProject: {
      apply: 'Start project',
      applying: 'Starting…',
      applied: 'Project started',
    },
    copyPlan: {
      apply: 'Copy plan',
      applying: 'Copying…',
      applied: 'Plan copied',
    },
    moveRecord: {
      apply: 'Move record',
      applying: 'Moving…',
      applied: 'Moved',
    },
    createFolder: {
      apply: 'Make folder',
      applying: 'Making…',
      applied: 'Folder made',
    },
    renameFolder: {
      apply: 'Rename folder',
      applying: 'Renaming…',
      applied: 'Renamed',
    },
    deleteFolder: {
      apply: 'Delete folder',
      applying: 'Deleting…',
      applied: 'Deleted',
    },
    fileInFolder: { apply: 'Move', applying: 'Moving…', applied: 'Moved' },
    followRecord: {
      apply: 'Follow',
      applying: 'Following…',
      applied: 'Following',
    },
    unfollowRecord: {
      apply: 'Stop following',
      applying: 'Stopping…',
      applied: 'Not following',
    },
    verifyAudit: {
      apply: 'Check now',
      applying: 'Checking…',
      applied: 'Checked',
    },
    revokeSqlLogin: {
      apply: 'Revoke login',
      applying: 'Revoking…',
      applied: 'Revoked',
    },
  },
} as const
