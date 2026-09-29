import { createEffect, createSignal, For, Show, onCleanup } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { SessionTask } from "./snapshot.ts"
import { createSessionTaskController } from "./controller.ts"
import type { SidebarState } from "./controller.ts"

function shortTitle(value: string) {
  const characters = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), (part) => part.segment)
  return characters.length > 28 ? `${characters.slice(0, 27).join("")}…` : value
}

function SessionTaskView(props: { sessionID: string }) {
  const context = usePlugin()
  const rpc = context.client.rpc(SessionTask)
  const [state, setState] = createSignal<SidebarState>({ loading: true, task: null, error: "" })
  const [expanded, setExpanded] = createSignal(true)
  const controller = createSessionTaskController(async (sessionID) => {
    const session = await context.client.session.get({ sessionID })
    return rpc.getSessionTask({ sessionID }, { location: session.location })
  }, setState)
  createEffect(() => controller.setSession(props.sessionID))
  onCleanup(() => controller.dispose())
  const toggle = (event: { button: number }) => {
    if (event.button === 0) setExpanded((value) => !value)
  }
  const heading = () => {
    const task = state().task?.task
    const pending = task ? task.total - task.doneCount : 0
    return `${expanded() ? "▼" : "▶"} Tarea${task ? ` · ${pending} ${pending === 1 ? "pendiente" : "pendientes"} · ${task.doneCount}/${task.total}` : ""}`
  }
  const reviewMarker = () => {
    const reviews = state().task?.task.reviews
    return reviews?.security === "off" ? "🔓 Omitido: seguridad" : ""
  }
  const detail = () => expanded() ? state().task?.task : undefined
  return <box flexDirection="column" marginTop={1}>
    <text fg={context.theme.text.base} onMouseDown={toggle}><strong>{heading()}</strong></text>
    <Show when={reviewMarker()}><text fg={context.theme.text.muted}>{reviewMarker()}</text></Show>
    <Show when={state().loading}><text fg={context.theme.text.muted}>Cargando…</text></Show>
    <Show when={state().error}><text fg={context.theme.text.muted}>Error al cargar tarea</text></Show>
    <Show when={!state().loading && !state().error && !state().task}><text fg={context.theme.text.muted}>Sin tarea asignada</text></Show>
    <Show when={detail()}>{(item) => <>
      <Show when={item().steps !== undefined} fallback={<text fg={context.theme.text.muted}>Lista pendiente de actualizar</text>}>
        <Show when={item().steps?.length} fallback={<text fg={context.theme.text.muted}>Sin pasos</text>}>
          <scrollbox maxHeight={10}>
            <For each={item().steps}>{(step) => {
              const active = step.id === (item().current?.id ?? item().next?.id)
              const label = `${{ done: "✓", pending: "○", in_progress: "→", blocked: "!" }[step.status]} ${shortTitle(step.title)}`
              return <text flexShrink={0} fg={active ? context.theme.text.base : context.theme.text.muted}>
                <Show when={active} fallback={label}><strong>{label}</strong></Show>
              </text>
            }}</For>
          </scrollbox>
        </Show>
      </Show>
      <Show when={item().blockers.length > 0}>
        <text fg={context.theme.text.muted}>{`Bloqueos: ${item().blockers.length}`}</text>
      </Show>
    </>}</Show>
  </box>
}

export default Plugin.define({
  id: "skynex-tasks.tui",
  setup(context) {
    return context.ui.slot({
      append: "sidebar.content",
      render: (slot) => <SessionTaskView sessionID={slot.sessionID} />,
    })
  },
})
