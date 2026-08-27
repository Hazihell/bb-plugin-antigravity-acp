# bb-plugin-antigravity-acp

Google Antigravity as a first-class bb agent provider through Antigravity's
official **ACP** server (`agy_acp_server.par`).

Registers the `acp-antigravity` provider (family `acp`), exactly like bb's
builtin ACP agents:

- `server.ts` — `bb.providers.register` with the launch spec in
  `experimental_bridgeOptions.acpLaunchSpec`; plugin settings for install
  paths; the `bb antigravity-acp status` and `bb antigravity-acp install`
  commands.
- `host.ts` — re-exports the canonical ACP provider bridge
  (`@get-bb/plugin-sdk/provider-bridge/acp`, the same bridge the builtin
  `provider-acp` plugin uses) and implements the host RPC the install/status
  commands call, so installs run on the target machine, not on the bb server.
- `install.ts` — shared install logic: resolves the official distribution
  from the ACP registry, downloads, extracts, and links the server binary and
  sandbox helper onto PATH (no environment variables needed).
- `icons/antigravity.svg` — provider mark (path-shaped, theme-tinted).

## Install the plugin

```sh
bb plugin install .      # from this directory
bb plugin reload antigravity-acp
```

## Install the server binary

```sh
bb antigravity-acp install
```

The command runs on the machine that will launch the agent (the current
thread's host, or `--machine <id-or-name>` to pick another enrolled machine):

- detects the platform/arch and takes the official zip URL for it from the
  ACP registry (`agentclientprotocol/registry` → `antigravity-acp`), falling
  back to a pinned copy embedded in the plugin;
- downloads and extracts into `~/.local/opt/agy-acp-server` (configurable via
  `--install-dir`, or the `installDir` plugin setting);
- symlinks `agy_acp_server.par` and its sandbox helper `localharness_external`
  into `~/.local/bin` (configurable via `--bin-dir` / `binDir`); on Windows it
  copies them and appends the dir to the user PATH;
- makes the binaries executable and records the install in a manifest.

Install once per machine that should run Antigravity threads. The provider
only appears on a machine where the health probe finds `agy_acp_server.par`
on PATH; the ACP server finds the sandbox helper on PATH too (the install
links both into `binDir`), so no per-machine environment variables are
needed.

```sh
bb antigravity-acp install --machine macbook        # this machine
bb antigravity-acp install --machine other-host     # another enrolled machine
```

The machine's daemon shell must have `binDir` on PATH. The command warns
when it is not; pick a dir that is (e.g. `/usr/local/bin`) with `--bin-dir`.

Useful flags:

```sh
bb antigravity-acp install --machine macbook        # install on a specific machine
bb antigravity-acp install --force                  # re-download even if already installed
bb antigravity-acp install --from ./agy-acp.zip     # explicit source (URL or local file)
bb antigravity-acp install --json                   # machine-readable output
```

`~/.local/bin` must be on the machine's PATH for the provider health probe to
find the server. The command warns when it is not.

## Verify

```sh
bb antigravity-acp status            # where the server is, per machine
bb provider list                     # acp-antigravity appears (visibility: installed)
bb provider models acp-antigravity
bb thread spawn --provider acp-antigravity --prompt 'hi'
```

## Auth

Auth is handled in-band by the ACP server (Google account OAuth, Gemini API
key, Agent Platform). First run surfaces a login flow in the thread. State
lives under `~/.gemini/antigravity-acp/settings.json`.
