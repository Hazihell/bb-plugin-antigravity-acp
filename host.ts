// bb-plugin-google-antigravity-acp host entry.
//
// Ships bb's canonical ACP provider bridge (@get-bb/plugin-sdk/
// provider-bridge/acp — the same bridge the builtin provider-acp plugin
// uses). The runtime spawns this artifact as the provider bridge; per-agent
// launch facts arrive in `options.providerOptions.acpLaunchSpec` from the
// server-side registration in server.ts.
//
// The same artifact also implements the plugin's host RPC (`bb
// google-antigravity-acp install` / `status`), so installs run on the machine
// where the daemon executes instead of on the bb server.
import { experimental_acpProviderBridge as canonicalBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { withProviderEnforcedApprovals } from "./approval-enforcement.js";
import { agyHostContract } from "./contract.js";
import { probeLocal, runInstall } from "./install.js";

// See approval-enforcement.ts: without this, a turn started by another
// thread auto-denies every approval and Antigravity locks the session.
const experimental_providerBridge = withProviderEnforcedApprovals(canonicalBridge);

export { experimental_providerBridge };

export default experimental_defineHostEntry({
  contract: agyHostContract,
  handlers: {
    install: async (input) =>
      runInstall({
        installDir: input.installDir,
        binDir: input.binDir,
        force: input.force,
        updatePath: input.updatePath,
        source: input.source,
      }),
    probe: async () => probeLocal(),
  },
});
