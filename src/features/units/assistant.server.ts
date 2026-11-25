/** Unit conversion for the model: it answers in the reply and changes nothing. */
import {
  isUnitsReadTool,
  runUnitsReadTool,
  unitsReadDefs,
} from './reads.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  readDefs: unitsReadDefs,
  isReadTool: isUnitsReadTool,
  runReadTool: runUnitsReadTool,
})
