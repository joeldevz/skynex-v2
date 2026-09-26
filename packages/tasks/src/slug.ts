import { TaskError } from "./errors.js";

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const MAX_SLUG_LENGTH = 80;

export function slugify(title: string): string {
  const deaccented = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const collapsed = deaccented
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  const truncated = collapsed.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "");
  if (!SLUG_PATTERN.test(truncated)) {
    throw new TaskError("INVALID_SLUG", `Cannot derive a valid slug from title: ${JSON.stringify(title)}`);
  }
  return truncated;
}

export function withCollisionSuffix(base: string, ordinal: number): string {
  const suffix = `-${ordinal}`;
  const head = base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, "");
  return `${head}${suffix}`;
}
