# bb-plugin-antigravity-acp

Google Antigravity as a first-class bb agent provider through Antigravity's
official **ACP** server (`agy_acp_server.par`).

Registers the `acp-antigravity` provider (family `acp`), exactly like bb's
builtin ACP agents:

- `server.ts` — `bb.providers.register` with the launch spec in
  `experimental_bridgeOptions.acpLaunchSpec` (plus a `bb antigravity-acp status`
  diagnostic command).
- `host.ts` — re-exports the canonical ACP provider bridge
  (`@get-bb/plugin-sdk/provider-bridge/acp`), the same bridge the builtin
  `provider-acp` plugin uses.
- `icons/antigravity.svg` — provider mark (path-shaped, theme-tinted).

## Install the server binary

1. Download the official ACP server for your platform. The current ACP Registry
   listing (agentclientprotocol/registry → `antigravity-acp`) points at
   `https://dl.google.com/agy-extensions/releases/...` — for macOS arm64:

   ```sh
   curl -L -o /tmp/agy-acp.zip https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-agy_acp_server_20260818_01_RC01-darwin-arm64.zip
   mkdir -p ~/.local/opt/agy-acp-server
   unzip -o /tmp/agy-acp.zip -d ~/.local/opt/agy-acp-server
   ```

2. Put both binaries on PATH (the server needs its sandbox helper
   `localharness_external` next to it or via `ANTIGRAVITY_HARNESS_PATH`):

   ```sh
   ln -s ~/.local/opt/agy-acp-server/agy_acp_server.par ~/.local/bin/agy_acp_server.par
   ln -s ~/.local/opt/agy-acp-server/localharness_external ~/.local/bin/localharness_external
   ```

   The launch spec in `server.ts` also sets `ANTIGRAVITY_HARNESS_PATH`
   explicitly; adjust it if your server lives elsewhere.

3. Install / reload the plugin:

   ```sh
   bb plugin install .      # from this directory
   bb plugin reload antigravity-acp
   ```

4. Verify:

   ```sh
   bb provider list                 # acp-antigravity appears (visibility: installed)
   bb provider models acp-antigravity
   bb thread spawn --provider acp-antigravity --prompt 'hi'
   ```

## Auth

Auth is handled in-band by the ACP server (Google account OAuth, Gemini API
key, Agent Platform). First run surfaces a login flow in the thread. State
lives under `~/.gemini/antigravity-acp/settings.json`.
