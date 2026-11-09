/** Record type, sheet definition and template cards in the browser: which actions are ours, how they run, their words. */
import { isSchemaAction } from '#/lib/assistant-schema'
import type {
  SchemaAction,
  SchemaProposeToolName,
} from '#/lib/assistant-schema'
import { defineAssistant } from '../define'

const words = (key: string) => `features.schema.cards.${key}`

export const assistant = defineAssistant<SchemaAction, SchemaProposeToolName>()(
  {
    isAction: isSchemaAction,
    async run(client, action) {
      // Schema jobs load only when a card's button is pressed.
      const { runSchemaAction } = await import('#/lib/assistant-schema-run')
      return runSchemaAction(client, action)
    },
    cardWords: {
      'schema.model_create': words('addRecordType'),
      'schema.field_retire': words('retireField'),
      'schema.option_add': words('addChoice'),
      'schema.option_rename': words('renameChoice'),
      'schema.option_retire': words('retireChoice'),
      'schema.rule_add': words('addRule'),
      'schema.rule_update': words('changeRule'),
      'schema.rule_remove': words('removeRule'),
      'schema.link_rule_set': words('setLinkRule'),
      'schema.link_rule_remove': words('removeLinkRule'),
      'schema.model_version_start': words('startTypeVersion'),
      'schema.model_version_publish': words('publishTypeVersion'),
      'schema.sheet_definition_publish': words('publishSheetDefinition'),
      'schema.sheet_definition_lifecycle': words('setSheetDefinitionState'),
      'schema.template_publish': words('publishTemplate'),
      'schema.sheet_rename': words('renameSheet'),
    },
  },
)
