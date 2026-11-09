/** People and workspace cards in the browser: which actions are ours, how they run, their words. */
import { isPeopleAction } from '#/lib/assistant-people'
import type {
  PeopleAction,
  PeopleProposeToolName,
} from '#/lib/assistant-people'
import { defineAssistant } from '../define'

const words = (key: string) => `notebook.assistantPanel.proposal.${key}`

export const assistant = defineAssistant<PeopleAction, PeopleProposeToolName>()(
  {
    isAction: isPeopleAction,
    async run(client, action) {
      // People and workspace jobs load only when a card's button is pressed.
      const { runPeopleAction } = await import('#/lib/assistant-people-run')

      return runPeopleAction(client, action)
    },
    cardWords: {
      'member.invite': words('inviteMember'),
      'invitation.revoke': words('revokeInvitation'),
      'member.role': words('changeRole'),
      'member.suspend': words('suspendMember'),
      'member.reinstate': words('reinstateMember'),
      'member.remove': words('removeMember'),
      'access.grant': words('grantAccess'),
      'access.revoke': words('revokeAccess'),
      'access.decide': words('decideAccess'),
      'group.create': words('createGroup'),
      'group.delete': words('deleteGroup'),
      'group.member': words('groupMember'),
      'workspace.rename': words('renameWorkspace'),
      'workspace.general': words('saveGeneral'),
      'client.create': words('createClient'),
      'client.share': words('shareWithClient'),
    },
  },
)
