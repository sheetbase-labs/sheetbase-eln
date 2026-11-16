/** The analysis card in the browser: which action is ours, how it runs, its words. */
import { isAnalysisAction } from '#/lib/results-analysis'
import type {
  AnalysisAction,
  AnalysisProposeToolName,
} from '#/lib/results-analysis'
import { defineAssistant } from '../define'

export const assistant = defineAssistant<
  AnalysisAction,
  AnalysisProposeToolName
>()({
  isAction: isAnalysisAction,
  async run(client, action) {
    // The analysis code and notebook writes load only when the button is pressed.
    const { runAnalysisAction } = await import('#/lib/results-analysis-run')

    return runAnalysisAction(client, action)
  },
  cardWords: {
    'analysis.add_to_notebook': 'features.resultsAnalysis.cards.addToNotebook',
    'analysis.add_saved': 'features.resultsAnalysis.cards.addSaved',
  },
})
