/** The record results read for the model: it answers in the reply and changes nothing. */
import {
  isRecordResultsReadTool,
  recordResultsReadDefs,
  runRecordResultsReadTool,
} from './reads.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  readDefs: recordResultsReadDefs,
  isReadTool: isRecordResultsReadTool,
  runReadTool: runRecordResultsReadTool,
})
