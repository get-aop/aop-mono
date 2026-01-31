import { type Api, getModel, type Model } from "@mariozechner/pi-ai";

/**
 * Gets the stored API key for Anthropic.
 */
export const getApiKey = (): string => {
  const token = process.env.AOP_AUTH_TOKEN;

  if (!token) {
    throw new Error(
      "Not authenticated. Run `aop auth` to set up authentication."
    );
  }

  return token;
};

/**
 * Gets the Anthropic model for the given model ID.
 */
export const getAnthropicModel = (modelId: string): Model<Api> => {
  // Map common model names to pi-ai model IDs
  const modelMap: Record<string, string> = {
    "claude-sonnet-4-20250514": "claude-sonnet-4-5",
    "claude-3-5-sonnet-20241022": "claude-sonnet-3-5-v2",
    "claude-3-opus-20240229": "claude-opus-3",
    "claude-sonnet-4-5": "claude-sonnet-4-5",
    "claude-opus-4-5": "claude-opus-4-5"
  };

  const piAiModelId = modelMap[modelId] ?? modelId;
  // Type assertion needed because getModel expects specific model names but we support dynamic mapping
  const model = getModel(
    "anthropic",
    piAiModelId as Parameters<typeof getModel>[1]
  );

  if (!model) {
    throw new Error(`Model not found: ${modelId}`);
  }

  return model;
};
