// JSON-only contract: safe to import from both server and terminal.
export type Step = { id: string; title: string }
export type ListedStep = Step & { status: "pending" | "in_progress" | "done" | "blocked" }
export type TaskProjection = {
  id: string
  title: string
  status: "open" | "in_progress" | "done" | "blocked"
  doneCount: number
  total: number
  current: Step | null
  next: Step | null
  blockers: Step[]
  steps?: ListedStep[]
  reviews?: Reviews
}
export type ReviewMode = "on" | "off" | "auto"
export type Reviews = { security?: ReviewMode }
export type Snapshot = { task: TaskProjection; updatedAt: number }
const invalid = () => new Error("Resumen de tarea inválido")

export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid()
  const own = Reflect.ownKeys(value)
  if (own.length !== keys.length || own.some((key) => typeof key !== "string" || !keys.includes(key))) throw invalid()
  for (const key of keys) {
    if (!Object.getOwnPropertyDescriptor(value, key)?.hasOwnProperty("value")) throw invalid()
  }
  return value as Record<string, unknown>
}
export function identifier(value: unknown, session = false): string {
  if (typeof value !== "string" || value.length > 128 ||
      !(session ? /^ses_[A-Za-z0-9_-]+$/ : /^[A-Za-z0-9][A-Za-z0-9_-]*$/).test(value) ||
      ["__proto__", "prototype", "constructor"].includes(value)) throw invalid()
  return value
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max) throw invalid()
  const clean = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").trim()
  if (!clean) throw invalid()
  return clean
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10_000) throw invalid()
  return value
}
function step(value: unknown): Step | null {
  if (value === null) return null
  const item = record(value, ["id", "title"])
  return { id: identifier(item.id), title: text(item.title, 120) }
}
function steps(value: unknown): ListedStep[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 999 ||
      Reflect.ownKeys(value).length !== value.length + 1) throw invalid()
  const result: ListedStep[] = []
  for (let index = 0; index < value.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(value, String(index))
    if (!entry || !Object.prototype.hasOwnProperty.call(entry, "value")) throw invalid()
    const item = record(entry.value, ["id", "title", "status"])
    const status = item.status
    if (status !== "pending" && status !== "in_progress" && status !== "done" && status !== "blocked") throw invalid()
    result.push({ id: identifier(item.id), title: text(item.title, 200), status })
  }
  if (new Set(result.map((item) => item.id)).size !== result.length) throw invalid()
  return result
}
function reviewMode(value: unknown): ReviewMode {
  if (value !== "on" && value !== "off" && value !== "auto") throw invalid()
  return value
}
function reviews(value: unknown): Reviews {
  const has = (key: string) => value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key)
  const item = record(value, ["security"].filter(has))
  return has("security") ? { security: reviewMode(item.security) } : {}
}
export function projection(value: unknown, requireSteps = false): TaskProjection {
  const hasSteps = value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "steps")
  const hasReviews = value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "reviews")
  if (requireSteps && !hasSteps) throw invalid()
  const item = record(value, ["id", "title", "status", "doneCount", "total", "current", "next", "blockers",
    ...(hasSteps ? ["steps"] : []), ...(hasReviews ? ["reviews"] : [])])
  const status = item.status
  if (status !== "open" && status !== "in_progress" && status !== "done" && status !== "blocked") throw invalid()
  const doneCount = count(item.doneCount), total = count(item.total)
  if (doneCount > total || !Array.isArray(item.blockers) || item.blockers.length > 20 ||
      Object.keys(item.blockers).length !== item.blockers.length) throw invalid()
  const blockers = Array.from(item.blockers, (value) => {
    const result = step(value)
    if (!result) throw invalid()
    return result
  })
  if (new Set(blockers.map((item) => item.id)).size !== blockers.length || blockers.length > total) throw invalid()
  const list = hasSteps ? steps(item.steps) : undefined
  if (list && (list.length !== total || list.filter((item) => item.status === "done").length !== doneCount)) throw invalid()
  return { id: identifier(item.id), title: text(item.title, 160), status, doneCount, total,
    current: step(item.current), next: step(item.next), blockers, ...(list ? { steps: list } : {}),
    ...(hasReviews ? { reviews: reviews(item.reviews) } : {}) }
}
// L3: `{id}` binds the session to a CLI task; the server fills the rest from `skynex task status`.
export function publication(value: unknown): TaskProjection | { id: string } | null {
  if (value === null) return null
  if (value !== null && typeof value === "object" && Reflect.ownKeys(value).length === 1)
    return { id: identifier(record(value, ["id"]).id) }
  return projection(value, true)
}
// Placeholder while only the binding is known: the sidebar shows the id as title.
export const bound = (id: string): TaskProjection =>
  ({ id, title: id, status: "open", doneCount: 0, total: 0, current: null, next: null, blockers: [] })
export function snapshot(value: unknown): Snapshot {
  const item = record(value, ["task", "updatedAt"])
  if (typeof item.updatedAt !== "number" || !Number.isSafeInteger(item.updatedAt) ||
      item.updatedAt < 0 || item.updatedAt > 8_640_000_000_000_000) throw invalid()
  return { task: projection(item.task), updatedAt: item.updatedAt }
}

const object = (properties: Record<string, unknown>) => ({ type: "object", properties,
  required: Object.keys(properties), additionalProperties: false })
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: "null" }] })
// Host RPC JSON-schema decoding rejects `pattern`; identifier() enforces it at both boundaries.
const id = { type: "string", minLength: 1, maxLength: 128 }
const stepSchema = object({ id, title: { type: "string", minLength: 1, maxLength: 120 } })
const listedStepSchema = object({ id, title: { type: "string", minLength: 1, maxLength: 200 },
  status: { enum: ["pending", "in_progress", "done", "blocked"] } })
const reviewSchema = { enum: ["on", "off", "auto"] }
const countSchema = { type: "integer", minimum: 0, maximum: 10_000 }
const taskSchema = object({ id, title: { type: "string", minLength: 1, maxLength: 160 },
  status: { enum: ["open", "in_progress", "done", "blocked"] }, doneCount: countSchema, total: countSchema,
  current: nullable(stepSchema), next: nullable(stepSchema),
  blockers: { type: "array", maxItems: 20, items: stepSchema },
  steps: { type: "array", maxItems: 999, items: listedStepSchema },
  reviews: { ...object({ security: reviewSchema }), required: [] } })
taskSchema.required = taskSchema.required.filter((key) => key !== "reviews")
const storedTaskSchema = { ...taskSchema, required: taskSchema.required.filter((key) => key !== "steps") }
export const updateSchema = object({ task: { anyOf: [taskSchema, object({ id }), { type: "null" }] } })
export const SessionTask = { id: "skynex.session-task", events: {}, methods: {
  getSessionTask: {
    input: object({ sessionID: { type: "string", minLength: 1, maxLength: 128 } }),
    output: nullable(object({ task: storedTaskSchema, updatedAt: { type: "integer", minimum: 0, maximum: 8_640_000_000_000_000 } })),
    errors: {},
  },
} }
