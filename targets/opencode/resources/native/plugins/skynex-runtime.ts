import { markSkynexPrompt } from "./prompt.ts";

interface Registration {}

interface SkynexPluginContext {
  storage: {
    set(key: string, value: unknown): Promise<void>;
  };
  session: {
    hook(
      name: "prompt",
      callback: (event: { metadata: Record<string, unknown> }) => void,
    ): Promise<Registration>;
  };
}

export default {
  id: "skynex.runtime",
  async setup(ctx: SkynexPluginContext) {
    await ctx.storage.set("installed", { version: "0.1.0" });
    await ctx.session.hook("prompt", markSkynexPrompt);
  },
};
