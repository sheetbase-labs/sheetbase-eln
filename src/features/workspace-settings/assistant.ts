/** The workspace settings cards in the browser: which actions are ours, how they run, their words. */
import { defineAssistant } from '../define'
import { isWorkspaceSettingsAction } from './cards'
import type {
  WorkspaceSettingsAction,
  WorkspaceSettingsProposeToolName,
} from './cards'

const words = (key: string) => `features.workspaceSettings.cards.${key}`

export const assistant = defineAssistant<
  WorkspaceSettingsAction,
  WorkspaceSettingsProposeToolName
>()({
  isAction: isWorkspaceSettingsAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed.
    const { runWorkspaceSettingsAction } = await import('./cards-run')

    return runWorkspaceSettingsAction(client, action)
  },
  cardWords: {
    'workspace_settings.rules': words('save'),
    'workspace_settings.ai': words('save'),
    'workspace_settings.id_prefixes': words('save'),
    'workspace_settings.data_access': words('save'),
    'workspace_settings.publishing': words('save'),
    'workspace_settings.hours': words('save'),
    'workspace_settings.access': words('save'),
    'workspace_settings.adopt_groups': words('adoptGroups'),
    'workspace_settings.refresh_tables': words('refreshTables'),
    'workspace_settings.revoke_login': words('revokeLogin'),
    'workspace_settings.ontology': words('save'),
    'workspace_settings.plugin_point': words('save'),
  },
})
