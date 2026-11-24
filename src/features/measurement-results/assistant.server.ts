/** One read for the model: the rows of a measurement table across datasets. */
import {
  isMeasurementResultsReadTool,
  measurementResultsReadDefs,
  runMeasurementResultsReadTool,
} from './reads.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  readDefs: measurementResultsReadDefs,
  isReadTool: isMeasurementResultsReadTool,
  runReadTool: runMeasurementResultsReadTool,
})
