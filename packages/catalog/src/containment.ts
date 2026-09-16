import * as nodePath from "node:path";

export interface PathApi {
  readonly sep: string;
  resolve(...segments: string[]): string;
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
}

export const isWithinRoot = (root: string, target: string, api: PathApi = nodePath): boolean => {
  const relativeTarget = api.relative(api.resolve(root), api.resolve(target));
  return relativeTarget !== ".." && !relativeTarget.startsWith(`..${api.sep}`) && !api.isAbsolute(relativeTarget);
};

export const assertWithinRoot = (root: string, target: string, message: string, api: PathApi = nodePath): void => {
  if (!isWithinRoot(root, target, api)) throw new Error(message);
};
