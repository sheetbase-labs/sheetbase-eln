/** The record type cards in the browser: which actions are ours, how they run, their words. */
import { defineAssistant } from '../define'
import { isModelsAction } from './cards'
import type { ModelsAction, ModelsProposeToolName } from './cards'

const words = (key: string) => `features.models.cards.${key}`

export const assistant = defineAssistant<ModelsAction, ModelsProposeToolName>()(
  {
    isAction: isModelsAction,
    async run(client, action) {
      // Loaded only when a card's button is pressed.
      const { runModelsAction } = await import('./cards-run')

      return runModelsAction(client, action)
    },
    cardWords: {
      'model.registry_create': words('addRegistry'),
      'model.request_create': words('addRequestForm'),
      'model.starter_create': words('addRecordType'),
      'model.supplier_create': words('addSupplierType'),
      'model.registry_set': words('setRegistry'),
      'model.registry_lot_kind': words('setLotType'),
      'model.registry_sameness': words('setSameness'),
      'model.incident_log_set': words('setIncidentLog'),
      'model.request_form_set': words('setRequestForm'),
      'model.supplier_list_set': words('setSupplierList'),
      'model_field.draft': words('addDraftField'),
      'model_field.add': words('addField'),
      'model_field.activate': words('switchOn'),
      'model_field.update': words('changeField'),
      'model_field.semantics': words('setMeaning'),
      'model_field.evolve': words('changeFieldInUse'),
      'model_field.plugin_type': words('setPluginType'),
      'model_field.promote': words('makeShared'),
      'record.set_type': words('changeType'),
      'registry.remove_parent': words('removeParent'),
    },
  },
)
