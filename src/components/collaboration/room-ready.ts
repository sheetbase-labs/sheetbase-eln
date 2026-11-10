import { createContext, useContext } from 'react'

export const RoomReadyContext = createContext(false)

/** True once the enclosing room has created its connection provider. */
export function useCollaborationRoomReady(): boolean {
  return useContext(RoomReadyContext)
}
