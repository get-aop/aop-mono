import type { LocalServerContext } from "../../context.ts";

export const getLinearAccessToken = async (ctx: LocalServerContext): Promise<string | null> => {
  const status = await ctx.linearTokenStore.getStatus();
  if (!status.connected) {
    return null;
  }

  if (status.locked) {
    throw new Error("Linear token store is locked");
  }

  const tokens = await ctx.linearTokenStore.read();
  return tokens.accessToken;
};
