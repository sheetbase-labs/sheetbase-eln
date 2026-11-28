/** The "why" read for the model: it answers in the reply and changes nothing. */
import {
  blockersReadDefs,
  isBlockersReadTool,
  runBlockersReadTool,
} from './reads.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  readDefs: blockersReadDefs,
  isReadTool: isBlockersReadTool,
  runReadTool: runBlockersReadTool,
})
