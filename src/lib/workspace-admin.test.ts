/** ADMIN-001 pure unit tests for workspace administration helpers. */
import { describe, expect, it } from 'vitest'

import { DataClientError } from './data-client'
import {
  INVITATION_STATUS_LABELS,
  PROJECT_ACCESS_LABELS,
  REGISTRATION_MODE_LABELS,
  WORKSPACE_ROLE_LABELS,
  WORKSPACE_ROLE_DESCRIPTIONS,
  describeAdminError,
  formatDate,
  formatRelativeTime,
  isOwnerRole,
  toProjectAccess,
  toWorkspaceInvitation,
  toWorkspaceMember,
  toWorkspaceSession,
  toWorkspaceSettings,
} from './workspace-admin'
import type {
  ProjectAccessWire,
  WorkspaceInvitationWire,
  WorkspaceMemberWire,
  WorkspaceSessionWire,
  WorkspaceSettingsWire,
} from './workspace-admin'

const timestamp = '2026-07-01T00:00:00Z'

describe('workspace-admin mappers', () => {
  it('maps a workspace member wire to domain', () => {
    const wire: WorkspaceMemberWire = {
      id: 'member-1',
      workspace_id: 'workspace-1',
      user_id: 'user-1',
      role: 'scientist',
      suspended_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    }
    expect(toWorkspaceMember(wire)).toMatchObject({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      suspendedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  })

  it('maps a workspace invitation wire to domain', () => {
    const wire: WorkspaceInvitationWire = {
      id: 'invitation-1',
      workspace_id: 'workspace-1',
      email: 'scientist@example.com',
      role: 'scientist',
      status: 'pending',
      expires_at: '2026-08-01T00:00:00Z',
      accepted_at: null,
      accepted_by_user_id: null,
      revoked_at: null,
      created_by_user_id: 'owner-1',
      created_at: timestamp,
      updated_at: timestamp,
    }
    expect(toWorkspaceInvitation(wire)).toMatchObject({
      workspaceId: 'workspace-1',
      expiresAt: '2026-08-01T00:00:00Z',
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
      createdByUserId: 'owner-1',
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  })

  it('maps workspace settings wire to domain', () => {
    const wire: WorkspaceSettingsWire = {
      id: 'settings-1',
      workspace_id: 'workspace-1',
      registration_mode: 'invitation_only',
      review_workflow_enabled: true,
      review_workflow_config: { approvals: 2 },
      signature_policy: { required: true },
      audit_retention_days: 365,
      integration_settings: { enabled: false },
      created_by_user_id: 'owner-1',
      created_at: timestamp,
      updated_at: timestamp,
    }
    expect(toWorkspaceSettings(wire)).toMatchObject({
      workspaceId: 'workspace-1',
      registrationMode: 'invitation_only',
      reviewWorkflowEnabled: true,
      reviewWorkflowConfig: { approvals: 2 },
      signaturePolicy: { required: true },
      auditRetentionDays: 365,
      integrationSettings: { enabled: false },
      createdByUserId: 'owner-1',
    })
  })

  it('maps project access wire to domain', () => {
    const wire: ProjectAccessWire = {
      id: 'access-1',
      workspace_id: 'workspace-1',
      project_id: 'project-1',
      user_id: 'user-1',
      access_level: 'editor',
      granted_by_user_id: 'owner-1',
      created_at: timestamp,
      updated_at: timestamp,
    }
    expect(toProjectAccess(wire)).toMatchObject({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      userId: 'user-1',
      accessLevel: 'editor',
      grantedByUserId: 'owner-1',
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  })

  it('maps a workspace session wire to domain', () => {
    const wire: WorkspaceSessionWire = {
      id: 'session-1',
      user_id: 'user-1',
      user_name: 'Test User',
      ip_address: '192.0.2.1',
      user_agent: 'Test browser',
      created_at: timestamp,
      expires_at: '2026-08-01T00:00:00Z',
    }
    expect(toWorkspaceSession(wire)).toMatchObject({
      userId: 'user-1',
      userName: 'Test User',
      ipAddress: '192.0.2.1',
      userAgent: 'Test browser',
      createdAt: timestamp,
      expiresAt: '2026-08-01T00:00:00Z',
    })
  })
})

describe('workspace-admin labels', () => {
  it('exposes the expected role, status, access, and registration labels', () => {
    expect(WORKSPACE_ROLE_LABELS).toEqual({
      owner: 'Owner',
      admin: 'Admin',
      member: 'Scientist',
      steward: 'Data Steward',
      scientist: 'Scientist',
      analyst: 'Analyst',
      reviewer: 'Reviewer',
      viewer: 'Viewer',
      client_viewer: 'Client viewer',
    })
    expect(WORKSPACE_ROLE_DESCRIPTIONS.viewer).toMatch(/Read-only/)
    expect(WORKSPACE_ROLE_DESCRIPTIONS.client_viewer).toMatch(/client portal/)
    expect(WORKSPACE_ROLE_DESCRIPTIONS.scientist).toMatch(/experiments/)
    expect(WORKSPACE_ROLE_DESCRIPTIONS.member).toBe(
      WORKSPACE_ROLE_DESCRIPTIONS.scientist,
    )
    expect(INVITATION_STATUS_LABELS).toEqual({
      pending: 'Pending',
      accepted: 'Accepted',
      revoked: 'Revoked',
      expired: 'Expired',
    })
    expect(PROJECT_ACCESS_LABELS).toEqual({
      owner: 'Owner',
      editor: 'Editor',
      viewer: 'Viewer',
    })
    expect(REGISTRATION_MODE_LABELS).toEqual({
      open: 'Open registration',
      invitation_only: 'Invitation only',
    })
  })
})

describe('workspace-admin formatting helpers', () => {
  it('identifies owner roles', () => {
    expect(isOwnerRole('owner')).toBe(true)
    expect(isOwnerRole('admin')).toBe(false)
    expect(isOwnerRole('viewer')).toBe(false)
  })

  it('formats relative times', () => {
    expect(formatRelativeTime(null)).toBe('Never')
    expect(
      formatRelativeTime(new Date(Date.now() - 60_000).toISOString()),
    ).toContain('ago')
    expect(formatRelativeTime(new Date().toISOString())).toMatch(
      /ago|just now/i,
    )
  })

  it('formats dates and handles missing values', () => {
    expect(formatDate(timestamp)).toMatch(/01 Jul 2026/)
    expect(formatDate(null)).toMatch(/Unknown|—/i)
  })
})

describe('describeAdminError', () => {
  it('maps known codes to messages', () => {
    const messages = {
      SB050: 'You cannot perform this action on your own account.',
      SB051: 'This action would remove the last workspace owner.',
      SB052: 'The selected member was not found in this workspace.',
      SB053: 'That role is not valid.',
      SB054: 'The session was not found.',
      SB055: 'You do not have owner access to perform this action.',
      SB056: 'The registration mode is not valid.',
      SB057: 'Audit retention days must be a positive number.',
      SB058: 'That access level is not valid.',
      SB059: 'The project was not found in this workspace.',
      SB060: 'The export limit exceeds the maximum allowed (5000 rows).',
      SB061: 'The invitation is invalid, expired, or already used.',
      SB062: 'Your identity does not match the invitation recipient.',
      SB033: 'This action belongs to a different workspace.',
      '42501': 'You do not have owner access to perform this action.',
    }
    for (const [code, message] of Object.entries(messages)) {
      expect(describeAdminError(new DataClientError(code, 'x', 400))).toBe(
        message,
      )
    }
  })

  it('falls back to the error message for unknown codes', () => {
    expect(describeAdminError(new DataClientError('SB999', 'boom', 400))).toBe(
      'boom',
    )
  })

  it('returns a generic message for non-DataClient errors', () => {
    expect(describeAdminError(new Error('nope'))).toMatch(/could not complete/i)
  })
})
