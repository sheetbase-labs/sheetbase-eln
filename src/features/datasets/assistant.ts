/** Dataset and measurement table cards in the browser: which actions are ours, how they run, their words. */
import { isDatasetsAction } from '#/lib/assistant-datasets'
import type {
  DatasetsAction,
  DatasetsProposeToolName,
} from '#/lib/assistant-datasets'
import { defineAssistant } from '../define'

const words = (key: string) => `features.datasets.cards.${key}`

export const assistant = defineAssistant<
  DatasetsAction,
  DatasetsProposeToolName
>()({
  isAction: isDatasetsAction,
  async run(client, action) {
    const { runDatasetsAction } = await import('#/lib/assistant-datasets-run')

    return runDatasetsAction(client, action)
  },
  cardWords: {
    'measurement_table.create': words('createMeasurementTable'),
    'measurement_table.edit': words('editMeasurementTable'),
    'measurement_table.publish': words('publishMeasurementTable'),
    'measurement_table.discard_draft': words('discardMeasurementDraft'),
    'measurement_table.retire': words('retireMeasurementTable'),
    'measurement_table.restore': words('restoreMeasurementTable'),
    'dataset.upgrade_table': words('upgradeDatasetTable'),
    'dataset.flag_value': words('flagDatasetValue'),
    'dataset.clear_flag': words('clearDatasetFlag'),
    'dataset.set_unit': words('setDatasetUnit'),
    'dataset.set_intended_use': words('setDatasetUse'),
    'dataset.keep_snapshot': words('keepDatasetSnapshot'),
    'dataset.plan_rows': words('planDatasetRows'),
    'intake.resolve': words('resolveIntakeProblem'),
  },
})
