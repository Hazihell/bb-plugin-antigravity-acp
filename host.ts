// bb-plugin-antigravity-acp host entry.
//
// Ships bb's canonical ACP provider bridge (@get-bb/plugin-sdk/
// provider-bridge/acp — the same bridge the builtin provider-acp plugin
// uses). The runtime spawns this artifact as the provider bridge; per-agent
// launch facts arrive in `options.providerOptions.acpLaunchSpec` from the
// server-side registration in server.ts.
import {
  experimental_acpProviderBridge as experimental_providerBridge,
} from "@get-bb/plugin-sdk/provider-bridge/acp";

export { experimental_providerBridge };
