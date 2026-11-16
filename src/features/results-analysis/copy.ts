/** Words for the analysis card and block, read as `t('features.resultsAnalysis.…')`. */
export const copy = {
  cards: {
    addToNotebook: {
      apply: 'Add to notebook',
      applying: 'Running the analysis…',
      applied: 'Added to the notebook',
    },
    addSaved: {
      apply: 'Add to notebook',
      applying: 'Adding to the notebook…',
      applied: 'Added to the notebook',
    },
  },
  studio: {
    saveAndAdd: 'Save and add to {identifier}',
    adding: 'Adding to the notebook…',
    couldSave: 'Could not save the analysis',
    nameTaken:
      'You already have an analysis with that name. Choose another name, or open that one to update it.',
    couldAdd: 'Could not add the analysis to the notebook',
    hint: 'Adds a live block to {identifier}, {title}. It shows the plot and key numbers and keeps itself up to date when the analysis or its data change.',
  },
  block: {
    figure: 'Fitted curve',
    points: 'Points',
    rmse: 'RMSE',
    working: 'Terms, checks and the full working',
  },
} as const
