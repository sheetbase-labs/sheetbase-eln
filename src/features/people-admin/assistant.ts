/** The people and client cards in the browser: which actions are ours, how they run, their words. */
import { defineAssistant } from '../define'
import { isPeopleAdminAction } from './cards'
import type { PeopleAdminAction, PeopleAdminProposeToolName } from './cards'

const words = (key: string) => `features.peopleAdmin.cards.${key}`

export const assistant = defineAssistant<
  PeopleAdminAction,
  PeopleAdminProposeToolName
>()({
  isAction: isPeopleAdminAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed.
    const { runPeopleAdminAction } = await import('./cards-run')

    return runPeopleAdminAction(client, action)
  },
  cardWords: {
    'people_admin.reissue_invitation': words('reissueInvitation'),
    'people_admin.revoke_session': words('revokeSession'),
    'people_admin.set_username': words('setUsername'),
    'people_admin.rename_client': words('renameClient'),
    'people_admin.archive_client': words('archiveClient'),
    'people_admin.client_message': words('clientMessage'),
  },
})
