import type { CredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export async function createSubscriptionModels(options: {
  authPath?: string;
  credentials?: CredentialStore;
}) {
  // ModelRuntime uses Pi's file lock and saves refreshed OAuth tokens in place.
  const models = await ModelRuntime.create({
    ...options,
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  const provider = models.getProvider("openai")!;
  // This demo uses the subscription only, even if OPENAI_API_KEY is present.
  models.registerNativeProvider({ ...provider, auth: { oauth: provider.auth.oauth } });
  const auth = await models.checkAuth("openai", { signal: AbortSignal.timeout(30_000) });
  if (auth?.type !== "oauth") {
    throw new Error('未找到 Pi 的 ChatGPT 订阅登录。请运行 pi，使用 /login 选择 OpenAI → Sign in with ChatGPT。');
  }
  return models;
}
