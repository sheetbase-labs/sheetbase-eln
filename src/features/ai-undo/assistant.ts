/** The undo card in the browser: which action is ours, how it runs, its words. */
import { defineAssistant } from '../define'
import { isUndoAction } from './undo'
import type { ChangesProposeToolName, UndoAction } from './undo'

export const assistant = defineAssistant<UndoAction, ChangesProposeToolName>()({
  isAction: isUndoAction,
  async run(client, action) {
    // Loaded only when the card's button is pressed, in the person's session.
    const { runUndoAction } = await import('./cards-run')

    return runUndoAction(client, action)
  },
  cardWords: {
    'changes.undo': 'features.aiUndo.cards.undoChanges',
  },
})
