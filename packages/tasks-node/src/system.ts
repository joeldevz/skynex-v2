import { randomUUID } from "node:crypto";
import type { Clock, IdGenerator } from "@skynex-internal/tasks";

export const systemClock: Clock = {
  nowIso: () => new Date().toISOString(),
};

export const uuidIds: IdGenerator = {
  newId: () => randomUUID(),
};
