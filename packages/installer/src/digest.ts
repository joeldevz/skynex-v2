import { createHash } from "node:crypto";
export const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
