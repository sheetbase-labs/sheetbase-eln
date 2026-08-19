import type { JsonSchema } from '#/lib/public-api-rpc-contracts'

const UUID: JsonSchema = { type: 'string', format: 'uuid' }
const TEXT: JsonSchema = { type: 'string' }
const BOOL: JsonSchema = { type: 'boolean' }
const INT: JsonSchema = { type: 'integer' }

const jsonMap = (description: string): JsonSchema => ({
  type: 'object',
  additionalProperties: { $ref: '#/components/schemas/JsonValue' },
  description,
})

const JSON_VALUE = { $ref: '#/components/schemas/JsonValue' } as const
const JSON_SCALAR = { $ref: '#/components/schemas/JsonScalar' } as const

const formulaExpression: JsonSchema = {
  type: 'object',
  required: ['language', 'source'],
  additionalProperties: false,
  properties: {
    language: { type: 'string', const: 'sheetbase-formula-v1' },
    source: { type: 'string', minLength: 1, maxLength: 8192 },
  },
}

export const PUBLIC_API_DOMAIN_SCHEMAS = {
  JsonScalar: {
    description:
      'JSON scalar: string, number, boolean, or null. Used for Dataset filter values and typed parameter scalars.',
    oneOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'null' },
    ],
  },
  JsonValue: {
    description:
      'Any JSON value: scalar, array, object, or null. Canonical cell, parameter, and calculation values.',
    oneOf: [
      { $ref: '#/components/schemas/JsonScalar' },
      {
        type: 'array',
        items: { $ref: '#/components/schemas/JsonValue' },
      },
      {
        type: 'object',
        additionalProperties: { $ref: '#/components/schemas/JsonValue' },
      },
    ],
  },
  JsonObjectMap: jsonMap('Open object map (field name or UUID keys).'),
  TemplateParameter: {
    type: 'object',
    required: ['id', 'key', 'label', 'required', 'type', 'constraints'],
    additionalProperties: false,
    properties: {
      id: UUID,
      key: TEXT,
      label: TEXT,
      required: BOOL,
      type: {
        oneOf: [
          {
            type: 'object',
            required: ['kind', 'valueType'],
            additionalProperties: false,
            properties: {
              kind: { type: 'string', const: 'scalar' },
              valueType: {
                type: 'string',
                enum: [
                  'text',
                  'integer',
                  'decimal',
                  'boolean',
                  'date',
                  'timestamp',
                  'category',
                  'reference',
                ],
              },
            },
          },
          {
            type: 'object',
            required: ['kind', 'modelKey'],
            additionalProperties: false,
            properties: {
              kind: { type: 'string', const: 'record' },
              modelKey: TEXT,
            },
          },
          {
            type: 'object',
            required: ['kind', 'contract'],
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['dataset', 'dataset-version'] },
              contract: {
                type: 'object',
                required: ['mode'],
                additionalProperties: true,
                properties: {
                  mode: {
                    type: 'string',
                    enum: ['exact', 'lineage', 'semantic'],
                  },
                  schemaVersionId: UUID,
                },
              },
            },
          },
        ],
      },
      defaultValue: JSON_VALUE,
      constraints: {
        type: 'object',
        additionalProperties: false,
        properties: {
          min: { type: 'number' },
          max: { type: 'number' },
          minLength: INT,
          maxLength: INT,
          pattern: TEXT,
          allowedValues: {
            type: 'array',
            items: JSON_VALUE,
          },
        },
      },
    },
  },
  NotebookTemplatePlacement: {
    oneOf: [
      {
        type: 'object',
        required: ['id', 'kind', 'order', 'blockType', 'payload'],
        additionalProperties: false,
        properties: {
          id: UUID,
          kind: { type: 'string', const: 'narrative' },
          order: INT,
          blockType: { type: 'string' },
          payload: jsonMap('Narrative block payload.'),
        },
      },
      {
        type: 'object',
        required: [
          'id',
          'kind',
          'order',
          'definitionVersionId',
          'parameterMappings',
        ],
        additionalProperties: false,
        properties: {
          id: UUID,
          kind: { type: 'string', const: 'sheet' },
          order: INT,
          definitionVersionId: UUID,
          title: TEXT,
          parameterMappings: {
            type: 'array',
            maxItems: 64,
            items: {
              type: 'object',
              required: ['templateParameterId', 'definitionParameterId'],
              additionalProperties: false,
              properties: {
                templateParameterId: UUID,
                definitionParameterId: UUID,
              },
            },
          },
        },
      },
      {
        type: 'object',
        required: ['id', 'kind', 'order', 'key', 'label'],
        additionalProperties: false,
        properties: {
          id: UUID,
          kind: { type: 'string', const: 'section_placeholder' },
          order: INT,
          key: TEXT,
          label: TEXT,
        },
      },
    ],
  },
  NotebookTemplateConfiguration: {
    type: 'object',
    required: ['formatVersion', 'parameters', 'placements'],
    additionalProperties: false,
    properties: {
      formatVersion: { type: 'integer', const: 1 },
      parameters: {
        type: 'array',
        maxItems: 64,
        items: { $ref: '#/components/schemas/TemplateParameter' },
      },
      placements: {
        type: 'array',
        maxItems: 256,
        items: { $ref: '#/components/schemas/NotebookTemplatePlacement' },
      },
    },
  },
  FieldQuantity: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: TEXT,
      dimension: TEXT,
      storageUnit: TEXT,
      allowedInputUnits: { type: 'array', items: { type: 'string' } },
      preferredDisplayUnit: TEXT,
    },
  },
  FieldValidation: {
    type: 'object',
    additionalProperties: false,
    properties: {
      min: { type: 'number' },
      max: { type: 'number' },
      minLength: INT,
      maxLength: INT,
      pattern: TEXT,
      extensions: jsonMap('Extension bag.'),
    },
  },
  FieldCategory: {
    oneOf: [
      {
        type: 'object',
        required: ['kind', 'options'],
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'embedded' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'key', 'label', 'displayOrder', 'lifecycle'],
              additionalProperties: false,
              properties: {
                id: UUID,
                key: TEXT,
                label: TEXT,
                displayOrder: INT,
                lifecycle: { type: 'string', enum: ['active', 'retired'] },
              },
            },
          },
        },
      },
      {
        type: 'object',
        required: ['kind', 'vocabularyId'],
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'vocabulary' },
          vocabularyId: UUID,
        },
      },
    ],
  },
  FieldRelationship: {
    type: 'object',
    required: ['target', 'cardinality'],
    additionalProperties: false,
    properties: {
      target: {
        oneOf: [
          {
            type: 'object',
            required: ['kind', 'modelKey'],
            additionalProperties: false,
            properties: {
              kind: { type: 'string', const: 'model' },
              modelKey: TEXT,
            },
          },
          {
            type: 'object',
            required: ['kind', 'schemaId'],
            additionalProperties: false,
            properties: {
              kind: { type: 'string', const: 'dataset-schema' },
              schemaId: UUID,
            },
          },
        ],
      },
      cardinality: { type: 'string', enum: ['one', 'many'] },
    },
  },
  SheetFieldDefinition: {
    type: 'object',
    required: [
      'fieldId',
      'key',
      'label',
      'logicalType',
      'nullable',
      'cardinality',
      'validation',
      'computation',
      'lifecycle',
    ],
    additionalProperties: false,
    properties: {
      fieldId: UUID,
      key: TEXT,
      label: TEXT,
      description: { type: ['string', 'null'] },
      logicalType: {
        type: 'string',
        enum: [
          'text',
          'integer',
          'decimal',
          'boolean',
          'date',
          'timestamp',
          'category',
          'reference',
        ],
      },
      nullable: BOOL,
      defaultValue: JSON_VALUE,
      cardinality: { type: 'string', enum: ['one', 'many'] },
      quantity: {
        oneOf: [
          { $ref: '#/components/schemas/FieldQuantity' },
          { type: 'null' },
        ],
      },
      validation: { $ref: '#/components/schemas/FieldValidation' },
      category: {
        oneOf: [
          { $ref: '#/components/schemas/FieldCategory' },
          { type: 'null' },
        ],
      },
      relationship: {
        oneOf: [
          { $ref: '#/components/schemas/FieldRelationship' },
          { type: 'null' },
        ],
      },
      computation: {
        oneOf: [
          {
            type: 'object',
            required: ['mode'],
            additionalProperties: false,
            properties: { mode: { type: 'string', const: 'stored' } },
          },
          {
            type: 'object',
            required: ['mode', 'expressionId'],
            additionalProperties: false,
            properties: {
              mode: { type: 'string', const: 'computed' },
              expressionId: UUID,
            },
          },
        ],
      },
      lifecycle: {
        type: 'string',
        enum: ['draft', 'backfilling', 'active', 'retired'],
      },
    },
  },
  SheetDefinitionColumn: {
    type: 'object',
    required: ['id', 'field', 'source'],
    additionalProperties: false,
    properties: {
      id: UUID,
      field: { $ref: '#/components/schemas/SheetFieldDefinition' },
      source: {
        oneOf: [
          {
            type: 'object',
            required: ['kind'],
            additionalProperties: false,
            properties: { kind: { type: 'string', const: 'declared' } },
          },
          {
            type: 'object',
            required: ['kind', 'bindingId', 'sourceFieldId'],
            additionalProperties: false,
            properties: {
              kind: { type: 'string', const: 'bound' },
              bindingId: UUID,
              sourceFieldId: UUID,
            },
          },
          {
            type: 'object',
            required: ['kind', 'calculationId'],
            additionalProperties: false,
            properties: {
              kind: { type: 'string', const: 'calculated' },
              calculationId: UUID,
            },
          },
        ],
      },
    },
  },
  SheetDefinitionJoin: {
    type: 'object',
    required: [
      'id',
      'leftBindingId',
      'rightBindingId',
      'leftColumnId',
      'rightColumnId',
      'joinType',
      'cardinality',
    ],
    additionalProperties: false,
    properties: {
      id: UUID,
      leftBindingId: UUID,
      rightBindingId: UUID,
      leftColumnId: UUID,
      rightColumnId: UUID,
      joinType: { type: 'string', enum: ['inner', 'left'] },
      cardinality: { type: 'string', enum: ['one-to-one', 'many-to-one'] },
    },
  },
  SheetDefinitionBinding: {
    type: 'object',
    required: ['id', 'key', 'parameterId'],
    additionalProperties: false,
    properties: {
      id: UUID,
      key: TEXT,
      parameterId: UUID,
    },
  },
  SheetDefinitionConfiguration: {
    type: 'object',
    additionalProperties: false,
    properties: {
      formatVersion: { type: 'integer', const: 1 },
      parameters: {
        type: 'array',
        items: { $ref: '#/components/schemas/TemplateParameter' },
      },
      bindings: {
        type: 'array',
        items: { $ref: '#/components/schemas/SheetDefinitionBinding' },
      },
      rowIdentity: {
        type: 'object',
        required: ['kind', 'columnIds'],
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['source', 'composite', 'local'] },
          columnIds: { type: 'array', items: UUID, minItems: 1, maxItems: 8 },
        },
      },
      joins: {
        type: 'array',
        items: { $ref: '#/components/schemas/SheetDefinitionJoin' },
      },
      columns: {
        type: 'array',
        items: { $ref: '#/components/schemas/SheetDefinitionColumn' },
      },
      calculations: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'key', 'label', 'outputColumnId', 'expression'],
          additionalProperties: false,
          properties: {
            id: UUID,
            key: TEXT,
            label: TEXT,
            outputColumnId: UUID,
            inputColumnIds: { type: 'array', items: UUID },
            expression: formulaExpression,
          },
        },
      },
      presentation: jsonMap(
        'Column order, hidden columns, density, filters, sorts.',
      ),
    },
  },
  SheetParameterInput: {
    oneOf: [
      {
        type: 'object',
        required: ['parameterId', 'kind', 'value'],
        additionalProperties: false,
        properties: {
          parameterId: UUID,
          kind: { type: 'string', const: 'scalar' },
          value: JSON_SCALAR,
        },
      },
      {
        type: 'object',
        required: ['parameterId', 'kind', 'recordId'],
        additionalProperties: false,
        properties: {
          parameterId: UUID,
          kind: { type: 'string', const: 'record' },
          recordId: UUID,
        },
      },
      {
        type: 'object',
        required: ['parameterId', 'kind', 'datasetId'],
        additionalProperties: false,
        properties: {
          parameterId: UUID,
          kind: { type: 'string', const: 'dataset' },
          datasetId: UUID,
        },
      },
      {
        type: 'object',
        required: ['parameterId', 'kind', 'datasetVersionId'],
        additionalProperties: false,
        properties: {
          parameterId: UUID,
          kind: { type: 'string', const: 'dataset-version' },
          datasetVersionId: UUID,
        },
      },
    ],
  },
  SheetInstanceBinding: {
    oneOf: [
      {
        type: 'object',
        required: ['bindingId', 'parameterId', 'kind', 'datasetId', 'policy'],
        additionalProperties: false,
        properties: {
          bindingId: UUID,
          parameterId: UUID,
          kind: { type: 'string', const: 'dataset' },
          datasetId: UUID,
          resolution: {
            type: 'object',
            additionalProperties: false,
            properties: {
              compatibilityMode: {
                type: 'string',
                enum: ['exact', 'lineage', 'semantic'],
              },
              candidateSchemaVersionId: UUID,
              baselineSchemaVersionId: {
                type: ['string', 'null'],
                format: 'uuid',
              },
              requiredFieldIds: { type: 'array', items: UUID },
            },
          },
          policy: {
            oneOf: [
              {
                type: 'object',
                required: ['mode'],
                additionalProperties: false,
                properties: { mode: { type: 'string', const: 'live' } },
              },
              {
                type: 'object',
                required: ['mode', 'datasetVersionId'],
                additionalProperties: false,
                properties: {
                  mode: { type: 'string', const: 'version' },
                  datasetVersionId: UUID,
                },
              },
            ],
          },
        },
      },
      {
        type: 'object',
        required: ['bindingId', 'parameterId', 'kind', 'recordId', 'policy'],
        additionalProperties: false,
        properties: {
          bindingId: UUID,
          parameterId: UUID,
          kind: { type: 'string', const: 'record' },
          recordId: UUID,
          modelKey: TEXT,
          policy: { type: 'string', const: 'live' },
        },
      },
    ],
  },
  SheetCalculationDependency: {
    oneOf: [
      {
        type: 'object',
        required: ['kind', 'id'],
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'column' },
          id: UUID,
        },
      },
      {
        type: 'object',
        required: ['kind', 'id'],
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'local-field' },
          id: UUID,
        },
      },
      {
        type: 'object',
        required: ['kind', 'id'],
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'calculation' },
          id: UUID,
        },
      },
    ],
  },
  SheetCalculation: {
    type: 'object',
    required: [
      'id',
      'key',
      'label',
      'lifecycle',
      'outputField',
      'dependencies',
      'expression',
    ],
    additionalProperties: false,
    properties: {
      id: UUID,
      key: TEXT,
      label: TEXT,
      lifecycle: { type: 'string', enum: ['active', 'retired'] },
      outputField: { $ref: '#/components/schemas/SheetFieldDefinition' },
      dependencies: {
        type: 'array',
        maxItems: 64,
        items: { $ref: '#/components/schemas/SheetCalculationDependency' },
      },
      expression: formulaExpression,
    },
  },
  SheetInstanceState: {
    type: 'object',
    required: [
      'bindings',
      'localFields',
      'localValues',
      'calculationOverrides',
      'presentation',
      'provenance',
    ],
    additionalProperties: false,
    properties: {
      bindings: {
        type: 'array',
        maxItems: 64,
        items: { $ref: '#/components/schemas/SheetInstanceBinding' },
      },
      parameterValues: {
        type: 'array',
        maxItems: 64,
        items: {
          type: 'object',
          required: ['parameterId', 'kind', 'valueType', 'value', 'source'],
          additionalProperties: false,
          properties: {
            parameterId: UUID,
            kind: { type: 'string', const: 'scalar' },
            valueType: {
              type: 'string',
              enum: [
                'text',
                'integer',
                'decimal',
                'boolean',
                'date',
                'timestamp',
                'category',
                'reference',
              ],
            },
            value: JSON_SCALAR,
            source: { type: 'string', enum: ['supplied', 'default'] },
          },
        },
      },
      localFields: {
        type: 'array',
        maxItems: 256,
        items: { $ref: '#/components/schemas/SheetFieldDefinition' },
      },
      localValues: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          additionalProperties: { $ref: '#/components/schemas/JsonValue' },
          description: 'fieldId → scalar or array matching cardinality.',
        },
        description: 'Row key (`sb-row-v1:…` or UUID) → local cell map.',
      },
      calculationOverrides: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          required: ['enabled', 'expression'],
          additionalProperties: false,
          properties: {
            enabled: BOOL,
            expression: formulaExpression,
          },
        },
        description: 'calculationId → override.',
      },
      instanceCalculations: {
        type: 'array',
        maxItems: 128,
        items: { $ref: '#/components/schemas/SheetCalculation' },
      },
      presentation: {
        type: 'object',
        required: [
          'columnOrder',
          'hiddenColumnIds',
          'columnWidths',
          'frozenColumnCount',
          'density',
        ],
        additionalProperties: false,
        properties: {
          columnOrder: { type: 'array', items: UUID },
          hiddenColumnIds: { type: 'array', items: UUID },
          columnWidths: {
            type: 'object',
            additionalProperties: {
              type: 'integer',
              minimum: 40,
              maximum: 2000,
            },
          },
          frozenColumnCount: INT,
          density: {
            type: 'string',
            enum: ['compact', 'standard', 'comfortable'],
          },
          filters: {
            type: 'array',
            items: {
              type: 'object',
              required: ['columnId', 'operator'],
              additionalProperties: false,
              properties: {
                columnId: UUID,
                operator: {
                  type: 'string',
                  enum: ['equals', 'not-equals', 'is-empty', 'is-not-empty'],
                },
                value: JSON_SCALAR,
              },
            },
          },
          sorts: {
            type: 'array',
            items: {
              type: 'object',
              required: ['columnId', 'direction'],
              additionalProperties: false,
              properties: {
                columnId: UUID,
                direction: { type: 'string', enum: ['asc', 'desc'] },
              },
            },
          },
        },
      },
      provenance: {
        oneOf: [
          {
            type: 'object',
            required: ['createdFrom'],
            additionalProperties: false,
            properties: {
              createdFrom: { type: 'string', const: 'ad_hoc' },
            },
          },
          {
            type: 'object',
            required: ['createdFrom'],
            additionalProperties: false,
            properties: {
              createdFrom: { type: 'string', const: 'definition_version' },
            },
          },
          {
            type: 'object',
            required: ['createdFrom', 'duplicatedFromInstanceId'],
            additionalProperties: false,
            properties: {
              createdFrom: { type: 'string', const: 'duplicate' },
              duplicatedFromInstanceId: UUID,
            },
          },
        ],
      },
      resolutionProvenance: jsonMap('Resolved parameter/binding provenance.'),
      resolvedRowIdentity: {
        type: 'object',
        required: ['formatVersion', 'kind', 'columnIds', 'logicalTypes'],
        additionalProperties: false,
        properties: {
          formatVersion: { type: 'integer', const: 1 },
          kind: { type: 'string', enum: ['source', 'composite', 'local'] },
          columnIds: { type: 'array', items: UUID },
          logicalTypes: { type: 'array', items: { type: 'string' } },
          sourceBindingId: { type: ['string', 'null'], format: 'uuid' },
          sourceFieldId: { type: ['string', 'null'], format: 'uuid' },
        },
      },
    },
  },
  SheetCalculationChange: {
    oneOf: [
      {
        type: 'object',
        required: ['operation', 'calculation'],
        additionalProperties: false,
        properties: {
          operation: { type: 'string', enum: ['add', 'edit'] },
          calculation: { $ref: '#/components/schemas/SheetCalculation' },
        },
      },
      {
        type: 'object',
        required: ['operation', 'calculationId'],
        additionalProperties: false,
        properties: {
          operation: { type: 'string', const: 'retire' },
          calculationId: UUID,
        },
      },
    ],
  },
  SheetDefinitionUpgradeDecision: {
    oneOf: [
      {
        type: 'object',
        required: ['conflictId', 'outcome'],
        additionalProperties: false,
        properties: {
          conflictId: { type: 'string', minLength: 1 },
          outcome: { type: 'string', const: 'retain-local' },
        },
      },
      {
        type: 'object',
        required: ['conflictId', 'outcome', 'targetId'],
        additionalProperties: false,
        properties: {
          conflictId: { type: 'string', minLength: 1 },
          outcome: { type: 'string', const: 'map' },
          targetId: UUID,
        },
      },
      {
        type: 'object',
        required: ['conflictId', 'outcome'],
        additionalProperties: false,
        properties: {
          conflictId: { type: 'string', minLength: 1 },
          outcome: { type: 'string', const: 'defer' },
        },
      },
    ],
  },
  SheetDefinitionUpgradePreview: {
    type: 'object',
    required: [
      'source',
      'target',
      'automaticChanges',
      'conflicts',
      'preserved',
    ],
    additionalProperties: false,
    properties: {
      source: {
        type: 'object',
        required: [
          'definitionId',
          'versionId',
          'version',
          'instanceId',
          'instanceRevision',
        ],
        additionalProperties: false,
        properties: {
          definitionId: UUID,
          versionId: UUID,
          version: INT,
          instanceId: UUID,
          instanceRevision: INT,
        },
      },
      target: {
        type: 'object',
        required: ['definitionId', 'versionId', 'version'],
        additionalProperties: false,
        properties: {
          definitionId: UUID,
          versionId: UUID,
          version: INT,
        },
      },
      automaticChanges: {
        type: 'array',
        maxItems: 512,
        items: {
          type: 'object',
          required: ['kind', 'objectId'],
          additionalProperties: false,
          properties: {
            kind: { type: 'string' },
            objectId: UUID,
          },
        },
      },
      conflicts: {
        type: 'array',
        maxItems: 512,
        items: {
          type: 'object',
          required: ['id', 'kind', 'allowedOutcomes'],
          additionalProperties: false,
          properties: {
            id: TEXT,
            kind: TEXT,
            sourceId: { type: ['string', 'null'], format: 'uuid' },
            targetCandidates: { type: 'array', items: UUID },
            allowedOutcomes: {
              type: 'array',
              items: { type: 'string', enum: ['retain-local', 'map', 'defer'] },
            },
            instanceReferences: jsonMap(
              'Local/calculation/presentation usage.',
            ),
          },
        },
      },
      preserved: {
        type: 'object',
        additionalProperties: false,
        properties: {
          localFieldIds: { type: 'array', items: UUID },
          localValueRowCount: INT,
          instanceCalculationIds: { type: 'array', items: UUID },
          calculationOverrideIds: { type: 'array', items: UUID },
          presentationOwnedByInstance: BOOL,
          bindingProvenanceRevalidated: BOOL,
          writeOwnershipFromTarget: BOOL,
        },
      },
    },
  },
  SheetDefinitionUpgradeApplyResult: {
    oneOf: [
      {
        type: 'object',
        required: ['status', 'preview'],
        additionalProperties: false,
        properties: {
          status: { type: 'string', const: 'deferred' },
          preview: {
            $ref: '#/components/schemas/SheetDefinitionUpgradePreview',
          },
        },
      },
      {
        type: 'object',
        required: ['status', 'preview', 'instance', 'provenance'],
        additionalProperties: false,
        properties: {
          status: { type: 'string', const: 'applied' },
          preview: {
            $ref: '#/components/schemas/SheetDefinitionUpgradePreview',
          },
          instance: { $ref: '#/components/schemas/SheetInstancesRow' },
          provenance: {
            type: 'object',
            required: [
              'sourceDefinitionVersionId',
              'targetDefinitionVersionId',
              'sourceInstanceRevision',
              'resultingInstanceRevision',
              'upgradedAt',
            ],
            additionalProperties: true,
            properties: {
              sourceDefinitionVersionId: UUID,
              targetDefinitionVersionId: UUID,
              sourceInstanceRevision: INT,
              resultingInstanceRevision: INT,
              actorUserId: TEXT,
              upgradedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    ],
  },
  NotebookUpgradeDecision: {
    type: 'object',
    required: ['conflictId', 'outcome'],
    additionalProperties: false,
    properties: {
      conflictId: { type: 'string', minLength: 1 },
      outcome: { type: 'string', enum: ['keep', 'retarget'] },
      instanceDecisions: {
        type: 'array',
        items: { $ref: '#/components/schemas/SheetDefinitionUpgradeDecision' },
      },
    },
  },
  NotebookUpgradePreview: {
    type: 'object',
    required: [
      'recordId',
      'sourceVersionId',
      'targetVersionId',
      'automatic',
      'conflicts',
    ],
    additionalProperties: false,
    properties: {
      recordId: UUID,
      sourceVersionId: UUID,
      targetVersionId: UUID,
      automatic: {
        type: 'array',
        items: {
          type: 'object',
          required: ['kind'],
          additionalProperties: true,
          properties: {
            kind: {
              type: 'string',
              enum: [
                'placement-removed',
                'placement-added',
                'sheet-definition-compatible',
              ],
            },
            placementId: UUID,
            instanceId: UUID,
            targetDefinitionVersionId: UUID,
          },
        },
      },
      conflicts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'kind'],
          additionalProperties: true,
          properties: {
            id: TEXT,
            kind: {
              type: 'string',
              enum: ['sheet-placement-unresolved', 'sheet-definition-conflict'],
            },
            placementId: UUID,
            instanceId: UUID,
            allowedOutcomes: {
              type: 'array',
              items: { type: 'string', enum: ['keep', 'retarget'] },
            },
          },
        },
      },
    },
  },
  NotebookUpgradeApplyResult: {
    type: 'object',
    required: ['record', 'preview'],
    additionalProperties: false,
    properties: {
      record: { $ref: '#/components/schemas/RecordsRow' },
      preview: { $ref: '#/components/schemas/NotebookUpgradePreview' },
    },
  },
  CompositionAdoptionPreview: {
    type: 'object',
    required: [
      'instanceId',
      'instanceRevision',
      'compatible',
      'unmatchedLocalRowKeys',
      'preserved',
    ],
    additionalProperties: false,
    properties: {
      instanceId: UUID,
      instanceRevision: INT,
      notebookRecordId: { type: ['string', 'null'], format: 'uuid' },
      compatible: BOOL,
      errorCode: { type: ['string', 'null'] },
      errorMessage: { type: ['string', 'null'] },
      unmatchedLocalRowKeys: { type: 'array', items: { type: 'string' } },
      preserved: {
        type: 'object',
        required: [
          'instanceId',
          'localFieldIds',
          'localValueRowCount',
          'instanceCalculationIds',
        ],
        additionalProperties: true,
        properties: {
          instanceId: UUID,
          notebookRecordId: { type: ['string', 'null'], format: 'uuid' },
          localFieldIds: { type: 'array', items: UUID },
          localValueRowCount: INT,
          instanceCalculationIds: { type: 'array', items: UUID },
        },
      },
      target: {
        type: 'object',
        required: ['definitionId', 'versionId', 'version', 'workspaceId'],
        additionalProperties: true,
        properties: {
          definitionId: UUID,
          versionId: UUID,
          version: INT,
          workspaceId: UUID,
        },
      },
    },
  },
  CompositionAdoptionApplyResult: {
    oneOf: [
      {
        type: 'object',
        required: ['status', 'preview'],
        additionalProperties: false,
        properties: {
          status: { type: 'string', const: 'incompatible' },
          preview: { $ref: '#/components/schemas/CompositionAdoptionPreview' },
        },
      },
      {
        type: 'object',
        required: [
          'status',
          'idempotent',
          'preview',
          'instance',
          'unmatchedLocalRowKeys',
        ],
        additionalProperties: false,
        properties: {
          status: { type: 'string', const: 'applied' },
          idempotent: BOOL,
          preview: { $ref: '#/components/schemas/CompositionAdoptionPreview' },
          instance: { $ref: '#/components/schemas/SheetInstancesRow' },
          unmatchedLocalRowKeys: { type: 'array', items: { type: 'string' } },
        },
      },
    ],
  },
  MaterializationSourceVersion: {
    type: 'object',
    required: [
      'bindingId',
      'datasetId',
      'datasetRevision',
      'schemaVersionId',
      'pinKind',
      'policy',
    ],
    additionalProperties: false,
    properties: {
      bindingId: UUID,
      datasetId: UUID,
      datasetRevision: INT,
      schemaVersionId: UUID,
      pinKind: { type: 'string', enum: ['live-snapshot', 'pinned-version'] },
      datasetVersionId: { type: ['string', 'null'], format: 'uuid' },
      policy: {
        oneOf: [
          {
            type: 'object',
            required: ['mode'],
            additionalProperties: false,
            properties: { mode: { type: 'string', const: 'live' } },
          },
          {
            type: 'object',
            required: ['mode', 'datasetVersionId'],
            additionalProperties: false,
            properties: {
              mode: { type: 'string', const: 'version' },
              datasetVersionId: UUID,
            },
          },
        ],
      },
    },
  },
  MaterializationPreview: {
    type: 'object',
    required: [
      'instanceId',
      'instanceRevision',
      'definitionVersionId',
      'derivedOutputFields',
      'sourceVersions',
      'previewDigest',
    ],
    additionalProperties: false,
    properties: {
      instanceId: UUID,
      instanceRevision: INT,
      definitionVersionId: UUID,
      outputSchemaVersionId: { type: ['string', 'null'], format: 'uuid' },
      derivedOutputFields: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['id', 'kind', 'field'],
          additionalProperties: false,
          properties: {
            id: UUID,
            kind: {
              type: 'string',
              enum: [
                'definition-column',
                'local-field',
                'instance-calculation',
              ],
            },
            field: { $ref: '#/components/schemas/SheetFieldDefinition' },
            source: jsonMap(
              'Bound/declared/calculated source when kind is definition-column.',
            ),
            calculationId: UUID,
          },
        },
      },
      sourceVersions: {
        type: 'array',
        minItems: 1,
        items: { $ref: '#/components/schemas/MaterializationSourceVersion' },
      },
      previewDigest: {
        type: 'string',
        pattern: '^[0-9a-f]{64}$',
        description:
          'Required by materialize_sheet_instance as p_preview_digest.',
      },
    },
  },
  MaterializationResult: {
    type: 'object',
    required: [
      'materializationId',
      'datasetId',
      'datasetVersionId',
      'idempotent',
    ],
    additionalProperties: false,
    properties: {
      materializationId: UUID,
      datasetId: UUID,
      datasetVersionId: UUID,
      schemaVersionId: UUID,
      sourceVersions: {
        type: 'array',
        items: { $ref: '#/components/schemas/MaterializationSourceVersion' },
      },
      idempotent: BOOL,
    },
  },
  QuerySheetInstanceRowsResult: {
    type: 'object',
    required: [
      'instanceId',
      'revision',
      'offset',
      'limit',
      'hasMore',
      'identity',
      'rows',
    ],
    additionalProperties: false,
    properties: {
      instanceId: UUID,
      definitionVersionId: UUID,
      definitionConfiguration: {
        $ref: '#/components/schemas/SheetDefinitionConfiguration',
      },
      revision: INT,
      offset: INT,
      limit: INT,
      hasMore: BOOL,
      localFieldIds: { type: 'array', items: UUID },
      identity: {
        type: 'object',
        required: ['kind', 'columnIds', 'logicalTypes'],
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['source', 'composite', 'local'] },
          columnIds: { type: 'array', items: UUID },
          logicalTypes: { type: 'array', items: { type: 'string' } },
        },
      },
      rows: {
        type: 'array',
        items: {
          type: 'object',
          required: ['identityValues', 'sources'],
          additionalProperties: false,
          properties: {
            identityValues: { type: 'array', items: JSON_VALUE },
            sources: {
              type: 'array',
              items: {
                oneOf: [
                  {
                    type: 'object',
                    required: [
                      'sourceKind',
                      'bindingId',
                      'datasetId',
                      'matched',
                      'values',
                    ],
                    additionalProperties: false,
                    properties: {
                      sourceKind: { type: 'string', const: 'dataset' },
                      bindingId: UUID,
                      datasetId: UUID,
                      datasetRevision: INT,
                      rowId: { type: ['string', 'null'], format: 'uuid' },
                      revision: { type: ['integer', 'null'] },
                      matched: BOOL,
                      values: jsonMap('Field id → projected value.'),
                    },
                  },
                  {
                    type: 'object',
                    required: [
                      'sourceKind',
                      'bindingId',
                      'recordId',
                      'metadataVersion',
                      'fieldNames',
                      'matched',
                      'values',
                    ],
                    additionalProperties: false,
                    properties: {
                      sourceKind: { type: 'string', const: 'record' },
                      bindingId: UUID,
                      recordId: UUID,
                      metadataVersion: INT,
                      fieldNames: {
                        type: 'object',
                        additionalProperties: { type: 'string' },
                      },
                      matched: { type: 'boolean', const: true },
                      values: jsonMap('Field name → value.'),
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  },
  SheetRecordWriteTarget: {
    oneOf: [
      {
        type: 'object',
        required: [
          'kind',
          'datasetId',
          'rowId',
          'fieldId',
          'expectedDatasetRevision',
          'expectedRowRevision',
        ],
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'dataset' },
          datasetId: UUID,
          rowId: UUID,
          fieldId: UUID,
          expectedDatasetRevision: INT,
          expectedRowRevision: INT,
        },
      },
      {
        type: 'object',
        required: [
          'kind',
          'instanceId',
          'expectedRevision',
          'rowKey',
          'fieldId',
        ],
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'local' },
          instanceId: UUID,
          expectedRevision: INT,
          rowKey: TEXT,
          fieldId: UUID,
          identityValues: { type: 'array', items: JSON_VALUE },
          compositionOffset: INT,
        },
      },
      {
        type: 'object',
        required: ['kind', 'recordId', 'expectedMetadataVersion', 'fieldName'],
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'model' },
          recordId: UUID,
          expectedMetadataVersion: INT,
          fieldName: TEXT,
        },
      },
    ],
  },
  SheetRecordBatchRow: {
    type: 'object',
    required: ['rowKey', 'operation'],
    additionalProperties: false,
    properties: {
      rowKey: { type: 'string', minLength: 1 },
      operation: { type: 'string', enum: ['create', 'link'] },
      recordId: UUID,
      matchIdentifier: TEXT,
      title: TEXT,
      values: jsonMap('Model field name → canonical value.'),
      writeTarget: { $ref: '#/components/schemas/SheetRecordWriteTarget' },
    },
  },
  SheetRecordBatchRowResult: {
    type: 'object',
    required: ['rowIndex', 'rowKey', 'classification', 'errors'],
    additionalProperties: false,
    properties: {
      rowIndex: INT,
      rowKey: TEXT,
      classification: {
        type: 'string',
        enum: ['create', 'existing', 'match', 'invalid', 'link'],
      },
      recordId: { type: ['string', 'null'], format: 'uuid' },
      identifier: TEXT,
      errors: {
        type: 'array',
        items: {
          type: 'object',
          required: ['code', 'message'],
          additionalProperties: false,
          properties: {
            code: TEXT,
            message: TEXT,
            fieldName: TEXT,
            columnId: UUID,
          },
        },
      },
    },
  },
  SheetRecordBatchValidateResult: {
    type: 'object',
    required: ['ok', 'mutated', 'rows'],
    additionalProperties: false,
    properties: {
      ok: BOOL,
      mutated: { type: 'boolean', const: false },
      rows: {
        type: 'array',
        items: { $ref: '#/components/schemas/SheetRecordBatchRowResult' },
      },
    },
  },
  SheetRecordBatchCommitResult: {
    type: 'object',
    required: ['ok', 'mutated', 'idempotent', 'rows'],
    additionalProperties: false,
    properties: {
      ok: BOOL,
      mutated: BOOL,
      idempotent: BOOL,
      notebookRecordLink: BOOL,
      rows: {
        type: 'array',
        items: { $ref: '#/components/schemas/SheetRecordBatchRowResult' },
      },
    },
  },
  SheetCalculationResult: {
    type: 'object',
    required: [
      'calculationId',
      'rowKey',
      'scope',
      'calculationStatus',
      'resultKind',
      'permission',
    ],
    additionalProperties: false,
    properties: {
      calculationId: UUID,
      rowKey: TEXT,
      scope: { type: 'string', enum: ['definition', 'instance'] },
      definitionVersionId: { type: ['string', 'null'], format: 'uuid' },
      calculationStatus: { type: 'string', enum: ['current', 'stale'] },
      calculatedValue: JSON_VALUE,
      resultKind: { type: 'string', enum: ['value', 'error'] },
      errorCode: { type: ['string', 'null'] },
      diagnostic: { type: ['string', 'null'] },
      expression: formulaExpression,
      dependencies: {
        type: 'array',
        items: { $ref: '#/components/schemas/SheetCalculationDependency' },
      },
      outputField: { $ref: '#/components/schemas/SheetFieldDefinition' },
      sourceRevisions: jsonMap(
        'Source Dataset revisions used for this result.',
      ),
      dependencyProvenance: jsonMap('Dependency provenance.'),
      calculatedAt: { type: ['string', 'null'], format: 'date-time' },
      permission: {
        type: 'object',
        required: ['editability'],
        additionalProperties: false,
        properties: {
          editability: { type: 'string', const: 'read-only' },
        },
      },
    },
  },
  SheetCalculationResultsPage: {
    type: 'object',
    required: ['instanceId', 'revision', 'results'],
    additionalProperties: false,
    properties: {
      instanceId: UUID,
      revision: INT,
      results: {
        type: 'array',
        items: { $ref: '#/components/schemas/SheetCalculationResult' },
      },
    },
  },
  InstantiateNotebookTemplateResult: {
    type: 'object',
    required: ['record', 'templateVersionId', 'idempotent'],
    additionalProperties: false,
    properties: {
      record: { $ref: '#/components/schemas/RecordsRow' },
      templateVersionId: UUID,
      idempotent: BOOL,
    },
  },
  InsertSheetInstanceBlockResult: {
    type: 'object',
    required: ['block', 'structure_version'],
    additionalProperties: false,
    properties: {
      block: { $ref: '#/components/schemas/BlocksRow' },
      instance: { $ref: '#/components/schemas/SheetInstancesRow' },
      structure_version: INT,
    },
  },
} as const satisfies Record<string, JsonSchema>
