import {
  markReagentOrdered,
  receiveReagentOrder,
  requestReagentOrder,
} from './reagent-orders'
import { setInstrumentRate } from './facility-usage'
import { advanceRun } from './sample-workflows'
import { submitRequest } from './requests'
import {
  aliquotSample,
  consumeSample,
  registerSamples,
  transferSample,
} from './samples'
import { moveSampleToPosition } from './storage-positions'
import { describeActionError } from './assistant-bench'
import type { BenchAction } from './assistant-bench'
import type { DataClient } from './data-client'

/** Runs a bench card's action. Loaded only in the browser, when a button is pressed. */

/** Run a bench card's action through the ordinary RPCs, as the person. */
export async function runBenchAction(
  client: DataClient,
  action: BenchAction,
): Promise<void> {
  switch (action.kind) {
    case 'reagent.order':
      await requestReagentOrder(client, {
        materialRecordId: action.materialRecordId,
        quantity: action.quantity,
        unit: action.unit,
        note: action.note,
      })

      return
    case 'reagent.receive':
      await receiveReagentOrder(client, {
        orderId: action.orderId,
        lot: action.lot,
        expiry: action.expiry,
        quantity: action.quantity,
      })

      return
    case 'reagent.place':
      await markReagentOrdered(client, {
        orderId: action.orderId,
        orderReference: action.reference,
        expectedOn: action.expectedOn,
        supplier: action.supplier,
        supplierRecordId: action.supplierRecordId,
        totalPrice: action.price,
        currency: action.currency,
      })

      return
    case 'instrument.rate':
      await setInstrumentRate(client, {
        instrumentId: action.instrumentId,
        ratePerHour: action.ratePerHour,
        currency: action.ratePerHour === null ? null : action.currency,
      })

      return
    case 'samples.log': {
      const made = await registerSamples(client, {
        projectId: action.projectId,
        samples: action.samples,
      })

      // The samples are in; file each in its position. A failure here leaves
      // them registered and says so, rather than hiding what did happen.
      for (const [index, positionId] of action.positionIds.entries()) {
        const sample = made.at(index)

        if (!sample) break

        try {
          await moveSampleToPosition(client, {
            recordId: sample.id,
            positionId,
            expectedMetadataVersion: sample.metadataVersion,
          })
        } catch (error) {
          throw new Error(
            `${made.length} sample${made.length === 1 ? ' was' : 's were'} logged, but ${sample.identifier} could not be filed in its box: ${describeActionError(error)}`,
          )
        }
      }

      return
    }

    case 'sample.use':
      await consumeSample(client, {
        recordId: action.recordId,
        quantity: action.quantity,
        expectedMetadataVersion: action.expectedMetadataVersion,
        purposeRecordId: action.purposeRecordId ?? undefined,
        notes: action.notes ?? undefined,
      })

      return
    case 'sample.move':
      for (const move of action.moves) {
        if (move.positionId) {
          await moveSampleToPosition(client, {
            recordId: move.recordId,
            positionId: move.positionId,
            expectedMetadataVersion: move.expectedMetadataVersion,
            notes: action.notes ?? undefined,
          })
        } else if (move.toLocation) {
          await transferSample(client, {
            recordId: move.recordId,
            toLocation: move.toLocation,
            expectedMetadataVersion: move.expectedMetadataVersion,
            notes: action.notes ?? undefined,
          })
        }
      }

      return
    case 'sample.split':
      await aliquotSample(client, {
        recordId: action.recordId,
        count: action.count,
        quantityEach: action.quantityEach,
        unit: action.unit ?? undefined,
        purposeExperimentId: action.purposeExperimentId,
        expectedMetadataVersion: action.expectedMetadataVersion,
        notes: action.notes ?? undefined,
      })

      return
    case 'record.create':
      await client.rpc('create_model_record', {
        p_project_id: action.projectId,
        p_kind: action.modelKey,
        p_title: action.title,
        p_status: 'draft',
        p_tags: [],
        p_properties: {},
        p_custom_fields: action.customFields,
      })

      return
    case 'request.send':
      await submitRequest(client, {
        modelKey: action.modelKey,
        title: action.title,
        customFields: action.customFields,
        projectId: action.projectId,
        note: action.note,
      })

      return
    case 'sample.advance':
      await advanceRun(
        client,
        action.runId,
        action.toStageId,
        action.notes ?? undefined,
      )

      return
    case 'instrument.service':
      await client.rpc('set_instrument_out_of_service', {
        p_instrument_id: action.instrumentId,
        p_out_of_service: action.outOfService,
        p_reason: action.reason,
        p_expected_back_on: action.expectedBackOn,
        p_work_done: action.workDone,
      })

      return
    case 'storage.reading':
      await client.rpc('record_storage_readings', {
        p_unit_id: action.placeKind === 'unit' ? action.placeId : null,
        p_room_id: action.placeKind === 'room' ? action.placeId : null,
        p_readings: [
          {
            feed: action.feed.trim(),
            value: action.value,
            ...(action.unit ? { unit: action.unit } : {}),
          },
        ],
      })

      return
  }
}
