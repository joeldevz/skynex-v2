import { identifier, snapshot } from "./snapshot.ts"
import type { Snapshot } from "./snapshot.ts"

export type SidebarState = { loading: boolean; task: Snapshot | null; error: string }
export function createSessionTaskController(
  read: (sessionID: string) => Promise<unknown>,
  publish: (state: SidebarState) => void,
  clock = { every: (callback: () => void) => setInterval(callback, 4000), stop: (timer: ReturnType<typeof setInterval>) => clearInterval(timer) },
) {
  let sessionID = "", token = 0, disposed = false
  let timer: ReturnType<typeof setInterval> | undefined
  const refresh = async () => {
    if (disposed || !sessionID) return
    const request = ++token, requestedSession = sessionID
    try {
      const response = await read(requestedSession)
      const task = response === null ? null : snapshot(response)
      if (!disposed && request === token) publish({ loading: false, task, error: "" })
    } catch {
      if (!disposed && request === token) publish({ loading: false, task: null, error: "No se pudo cargar la tarea de esta sesión." })
    }
  }
  return {
    setSession(next: string) {
      if (disposed || next === sessionID) return
      ++token
      sessionID = ""
      if (timer !== undefined) clock.stop(timer)
      timer = undefined
      publish({ loading: true, task: null, error: "" })
      try { sessionID = identifier(next, true) } catch {
        publish({ loading: false, task: null, error: "Sesión no disponible." })
        return
      }
      void refresh()
      timer = clock.every(() => { void refresh() })
    },
    dispose() {
      disposed = true
      ++token
      if (timer !== undefined) clock.stop(timer)
      timer = undefined
    },
  }
}
