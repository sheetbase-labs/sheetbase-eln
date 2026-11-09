/**
 * People and the workspace: members, invitations, project access, groups,
 * workspace settings and the client portal.
 */
import { PEOPLE_OPERATIONS } from './operations'
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'people',
  operations: PEOPLE_OPERATIONS,
  agentArea: {
    area: 'People and workspace',
    match:
      /invitation|(change|suspend|reinstate|remove)_member|set_member_|member_absence|hand_over_member|project_access|project_member|workspace_|client|settings_access|project_settings|user_session|study_task_client/,
    beforeCore: true,
  },
  // Deleting a group is allowed, behind a confirmation like any other write.
  agentMayDelete: ['delete_workspace_group'],
})
