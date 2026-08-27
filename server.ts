// bb-plugin-antigravity-acp — Google Antigravity as a first-class bb agent
// provider through the official Antigravity ACP server (`agy_acp_server.par`).
//
// The provider id is `acp-antigravity` (same family "acp" as the builtin ACP
// agents). Everything agent-specific the bridge needs travels in
// `experimental_bridgeOptions.acpLaunchSpec`; the bridge itself is the
// canonical ACP bridge shipped in host.ts.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type BbPluginApi } from "@get-bb/plugin-sdk";

const execFileAsync = promisify(execFile);

/** Immutable launch facts for the ACP server process. */
const LAUNCH = {
  displayName: "Google Antigravity",
  // Found on PATH (install to ~/.local/bin or equivalent). Health probes use
  // `which`; an absolute path also works.
  command: "agy_acp_server.par",
  args: [] as string[],
  env: {
    // The ACP server resolves its sandbox helper `localharness_external`
    // from PATH, ANTIGRAVITY_HARNESS_PATH, or an explicit flag. Point it at
    // the helper shipped next to the server binary (same directory as the
    // official distribution zip).
    ANTIGRAVITY_HARNESS_PATH: "/Users/rawizhere/.local/opt/agy-acp-server/localharness_external",
  } as Record<string, string>,
};

export default async function plugin(bb: BbPluginApi) {
  bb.providers.register({
    id: "acp-antigravity",
    displayName: "Google Antigravity",
    family: "acp",
    icon: "./icons/antigravity.svg",
    strings: {
      // The Antigravity server authenticates in-band (ACP auth requests):
      // oauth-personal (Google account), oauth-business (Gemini Enterprise),
      // gemini-api-key, or agent-platform (ADC/API key).
      signInHint:
        "Open a Google Antigravity thread and follow the login prompt (Google account, Gemini API key, or Agent Platform).",
      expiredHint:
        "Your Google Antigravity session expired. Start a thread and re-authenticate in the login prompt.",
      installUrl: "https://antigravity.google/docs/ide/extensions/zed",
      iconTint: { light: "#4285F4", dark: "#8AB4F8" },
    },
    serviceTiers: [
      { id: "default", label: "Default" },
      { id: "fast", label: "Fast" },
    ],
    // Only listed on hosts where the ACP server binary is installed and the
    // bridge health probe passes.
    experimental_visibility: "installed",
    // Every ACP agent answers model/list from its own account/agent state, so
    // one probe per machine serves every workspace on it.
    models: { scope: "host" },
    maintenance: { health: true, usage: false, installation: false },
    capabilities: {
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      // agy_acp_server.par advertises sessionCapabilities {list, resume}; no
      // session/fork.
      fork: "none",
      permissionModes: ["accept-edits", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
    },
    composerActions: [],
    experimental_bridgeOptions: {
      acpLaunchSpec: LAUNCH,
    },
  });

  // Small diagnostic command: where is the ACP server, and what does bb know
  // about the provider.
  bb.cli.register({
    name: "antigravity-acp",
    summary: "Inspect the Google Antigravity ACP provider",
    commands: [
      {
        name: "status",
        summary: "Show the ACP server binary location and provider id",
        usage: "bb antigravity-acp status [--json]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      let binary = null;
      try {
        const { stdout } = await execFileAsync("which", [LAUNCH.command]);
        binary = stdout.split(/\r?\n/u)[0]?.trim() ?? null;
      } catch {
        binary = null;
      }
      const status = {
        providerId: "acp-antigravity",
        displayName: LAUNCH.displayName,
        command: LAUNCH.command,
        resolvedBinary: binary,
        hint:
          binary === null
            ? "Install the Antigravity ACP server and put `agy_acp_server.par` on PATH, or edit LAUNCH.command in server.ts to an absolute path."
            : "Ready. The provider appears in `bb provider list` when the bridge health probe passes.",
      };
      return {
        exitCode: 0,
        stdout: json ? JSON.stringify(status) : [
          `providerId:  ${status.providerId}`,
          `displayName: ${status.displayName}`,
          `command:     ${status.command}`,
          `binary:      ${status.resolvedBinary ?? "NOT FOUND"}`,
          "",
          status.hint,
        ].join("\n"),
      };
    },
  });
}
