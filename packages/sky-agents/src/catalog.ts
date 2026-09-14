export interface AgentRecord { id: string; hidden?: boolean; mode?: string }
export function profileAgents(agents: readonly AgentRecord[]): AgentRecord[] { return agents.filter((a) => !a.hidden && !a.id.startsWith("_") && (a.id === "thalam" || a.mode === "subagent" || a.mode === "all")).sort((a, b) => a.id.localeCompare(b.id)) }
