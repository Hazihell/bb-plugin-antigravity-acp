// Shared install logic for the Antigravity ACP server.
// Runs on the target machine from the host entry, and directly in the server
// process as the server-local fallback.
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DistEntry {
  archive: string;
  cmd: string;
  args?: string[];
}

export type DistMap = Record<string, DistEntry>;

// Mirrors the ACP registry entry (agentclientprotocol/registry →
// antigravity-acp → distribution.binary). The live registry is fetched first
// so installs track new releases without a plugin update.
export const FALLBACK_DIST: DistMap = {
  "darwin-aarch64": {
    archive:
      "https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-agy_acp_server_20260818_01_RC01-darwin-arm64.zip",
    cmd: "./agy_acp_server.par",
  },
  "linux-x86_64": {
    archive:
      "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-agy_acp_server_20260818_01_RC01-linux-x86_64.zip",
    cmd: "./agy_acp_server.par",
    args: ["--uid="],
  },
  "linux-aarch64": {
    archive:
      "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-agy_acp_server_20260818_01_RC01-linux-arm64.zip",
    cmd: "./agy_acp_server.par",
    args: ["--uid="],
  },
  "windows-x86_64": {
    archive:
      "https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-agy_acp_server_20260818_01_RC01-windows-x86_64.zip",
    cmd: "./agy_acp_server.exe",
  },
  "windows-aarch64": {
    archive:
      "https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-agy_acp_server_20260818_01_RC01-windows-arm64.zip",
    cmd: "./agy_acp_server.exe",
  },
};

export interface InstallOptions {
  installDir: string;
  binDir: string;
  force: boolean;
  /** Optional explicit source: a zip URL or a local zip path. Skips the ACP registry lookup. */
  source?: string;
}

export interface InstallResult {
  ok: boolean;
  platform: string;
  arch: string;
  distKey: string;
  url: string;
  installDir: string;
  binDir: string;
  binaryPath: string | null;
  harnessPath: string | null;
  alreadyInstalled: boolean;
  error: string | null;
  notes: string[];
}

export interface ProbeResult {
  ok: boolean;
  platform: string;
  arch: string;
  binaryPath: string | null;
  harnessPath: string | null;
  error: string | null;
}

const MANIFEST = ".antigravity-acp.json";

export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
  if (p.startsWith("$HOME/")) return join(homedir(), p.slice(6));
  return p;
}

export interface TargetInfo {
  platform: string;
  arch: string;
  distKey: string;
  binaryName: string;
  isWindows: boolean;
}

export function detectTarget(): TargetInfo {
  const platform = process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;
  return {
    platform,
    arch,
    distKey: `${platform}-${arch}`,
    binaryName: platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par",
    isWindows: platform === "win32",
  };
}

export async function fetchDistMap(): Promise<DistMap> {
  try {
    const res = await fetch(
      "https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json",
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return FALLBACK_DIST;
    const json = (await res.json()) as {
      distribution?: { binary?: Record<string, { archive?: unknown; cmd?: unknown; args?: unknown }> };
    };
    const binary = json.distribution?.binary;
    if (!binary) return FALLBACK_DIST;
    const map: DistMap = {};
    for (const [key, entry] of Object.entries(binary)) {
      if (typeof entry.archive === "string" && typeof entry.cmd === "string") {
        map[key] = {
          archive: entry.archive,
          cmd: entry.cmd,
          args: Array.isArray(entry.args) ? entry.args.map((a) => String(a)) : undefined,
        };
      }
    }
    return Object.keys(map).length > 0 ? map : FALLBACK_DIST;
  } catch {
    return FALLBACK_DIST;
  }
}

async function findOnPath(name: string): Promise<string | null> {
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(process.platform === "win32" ? ";" : ":");
  const patterns = process.platform === "win32"
    ? [name, ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean).map((ext) => name + ext)]
    : [name];
  for (const dir of dirs) {
    for (const candidate of patterns) {
      try {
        const full = join(dir || ".", candidate);
        const s = await stat(full);
        if (s.isFile()) return full;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (HTTP ${res.status}) from ${url}`);
  }
  // fetch returns undici's ReadableStream; Readable.fromWeb wants node's web
  // ReadableStream. Same object at runtime — cast across the declaration gap.
  await pipeline(
    Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>),
    createWriteStream(dest),
  );
}

async function extractZip(zipPath: string, destDir: string, isWindows: boolean): Promise<void> {
  if (isWindows) {
    // Windows ships bsdtar (tar.exe) which reads zip archives.
    await execFileAsync("tar", ["-xf", zipPath, "-C", destDir]);
    return;
  }
  try {
    await execFileAsync("unzip", ["-oq", zipPath, "-d", destDir]);
  } catch {
    await execFileAsync("tar", ["-xf", zipPath, "-C", destDir]);
  }
}

async function helperNameIn(installDir: string, isWindows: boolean): Promise<string | null> {
  const expected = isWindows ? /^localharness[^/\\]*\.exe$/i : /^localharness[^/\\]*$/i;
  const entries = await readdir(installDir).catch(() => [] as string[]);
  return entries.find((name) => expected.test(name)) ?? null;
}

async function ensureLinked(installDir: string, binDir: string, name: string, isWindows: boolean, notes: string[]): Promise<string> {
  const target = join(installDir, name);
  const link = join(binDir, name);
  if (isWindows) {
    await copyFile(target, link);
    return link;
  }
  try {
    await rm(link, { force: true });
    await symlink(target, link);
    return link;
  } catch (err) {
    notes.push(`Symlink ${name} failed in ${binDir}: ${(err as Error).message}. Copied instead.`);
    await copyFile(target, link);
    return link;
  }
}

async function appendUserPathWindows(binDir: string, notes: string[]): Promise<void> {
  try {
    const { stdout } = await execFileAsync("reg", ["query", "HKCU\\Environment", "/v", "Path"], { windowsHide: true });
    const current = stdout.split(/\r?\n/u).find((l) => /^\s*Path\s+REG/i.test(l))?.replace(/^\s*Path\s+REG[A-Z_]*\s+/i, "").trim() ?? "";
    const parts = current.split(";").filter(Boolean);
    if (parts.includes(binDir)) return;
    const next = [...parts, binDir].join(";");
    await execFileAsync("setx", ["Path", next], { windowsHide: true });
    notes.push(`Added ${binDir} to the user PATH (setx). Restart the bb daemon so it takes effect.`);
  } catch (err) {
    notes.push(`Could not update the user PATH: ${(err as Error).message}. Add ${binDir} to PATH manually.`);
  }
}

async function writeManifest(installDir: string, url: string, binaryName: string, helper: string | null): Promise<void> {
  await writeFile(
    join(installDir, MANIFEST),
    JSON.stringify({ url, binaryName, helper, installedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

export async function runInstall(options: InstallOptions): Promise<InstallResult> {
  const notes: string[] = [];
  const target = detectTarget();
  const installDir = expandHome(options.installDir);
  const binDir = expandHome(options.binDir);
  const binaryName = target.binaryName;
  const binaryPath = join(installDir, binaryName);
  const fail = (error: string): InstallResult => ({
    ok: false, platform: target.platform, arch: target.arch, distKey: target.distKey,
    url: "", installDir, binDir, binaryPath: null, harnessPath: null,
    alreadyInstalled: false, error, notes,
  });

  const distMap = await fetchDistMap();
  const entry = distMap[target.distKey];
  if (!entry) {
    return fail(
      `No Antigravity ACP distribution for ${target.platform} ${target.arch} in the ACP registry ` +
      `(agentclientprotocol/registry → antigravity-acp). Supported: ${Object.keys(distMap).join(", ")}.`,
    );
  }

  try {
    await mkdir(installDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
  } catch (err) {
    return fail(`Could not create directories: ${(err as Error).message}`);
  }

  // Already installed and not forced: just make sure the links are in place.
  const existing = await stat(binaryPath).catch(() => null);
  if (existing?.isFile() && !options.force) {
    try {
      const helper = await helperNameIn(installDir, target.isWindows);
      const link = await ensureLinked(installDir, binDir, binaryName, target.isWindows, notes);
      if (helper) await ensureLinked(installDir, binDir, helper, target.isWindows, notes);
      notes.push("Binary already present; refreshed symlinks without re-downloading.");
      return {
        ok: true, platform: target.platform, arch: target.arch, distKey: target.distKey, url: entry.archive,
        installDir, binDir, binaryPath: link, harnessPath: helper ? join(installDir, helper) : null,
        alreadyInstalled: true, error: null, notes,
      };
    } catch (err) {
      return fail(`Binary exists but links could not be refreshed: ${(err as Error).message}`);
    }
  }

  const sourceOverride = options.source?.trim() || process.env.AGY_ACP_INSTALL_FROM?.trim();
  let sourceLabel: string;
  try {
    const zipPath = join(tmpdir(), `agy-acp-${Date.now()}.zip`);
    try {
      if (sourceOverride) {
        sourceLabel = sourceOverride;
        if (/^https?:\/\//i.test(sourceOverride)) {
          notes.push(`Downloading ${sourceOverride}`);
          await downloadTo(sourceOverride, zipPath);
        } else {
          notes.push(`Using local archive ${sourceOverride}`);
          await copyFile(sourceOverride, zipPath);
        }
      } else {
        sourceLabel = entry.archive;
        notes.push(`Downloading ${entry.archive}`);
        await downloadTo(entry.archive, zipPath);
      }
      await extractZip(zipPath, installDir, target.isWindows);
    } finally {
      await rm(zipPath, { force: true });
    }
  } catch (err) {
    return fail(`Download or extraction failed: ${(err as Error).message}`);
  }

  const installed = await stat(binaryPath).catch(() => null);
  if (!installed?.isFile()) {
    return fail(`Extraction finished but ${binaryName} was not found in ${installDir}.`);
  }

  try {
    if (!target.isWindows) {
      await chmod(binaryPath, 0o755);
    }
    const helper = await helperNameIn(installDir, target.isWindows);
    if (helper) {
      const full = join(installDir, helper);
      if (!target.isWindows) await chmod(full, 0o755);
      notes.push(`Sandbox helper: ${full}`);
    }
    await writeManifest(installDir, sourceLabel, binaryName, helper);
  } catch (err) {
    notes.push(`Post-install step failed (continuing): ${(err as Error).message}`);
  }

  const link = await ensureLinked(installDir, binDir, binaryName, target.isWindows, notes).catch((err) => {
    notes.push(`Linking ${binaryName} failed: ${(err as Error).message}`);
    return null;
  });
  const helper = await helperNameIn(installDir, target.isWindows);
  if (link && helper) {
    await ensureLinked(installDir, binDir, helper, target.isWindows, notes).catch((err) => {
      notes.push(`Linking ${helper} failed: ${(err as Error).message}`);
    });
  }
  if (target.isWindows) {
    await appendUserPathWindows(binDir, notes);
  }
  const harnessPath = helper ? join(installDir, helper) : null;

  const pathDirs = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":");
  if (!pathDirs.includes(binDir)) {
    notes.push(
      `${binDir} is not on this machine's PATH. Add it, e.g. export PATH="$PATH:${binDir}" in your shell profile.`,
    );
  }

  return {
    ok: true, platform: target.platform, arch: target.arch, distKey: target.distKey, url: sourceLabel,
    installDir, binDir, binaryPath: link, harnessPath,
    alreadyInstalled: false, error: null, notes,
  };
}

export async function probeLocal(): Promise<ProbeResult> {
  const target = detectTarget();
  const binaryName = target.binaryName;
  const binaryPath = await findOnPath(binaryName);
  let harnessPath: string | null = null;
  const envHarness = process.env.ANTIGRAVITY_HARNESS_PATH?.trim();
  if (envHarness) {
    harnessPath = envHarness;
  } else {
    const probable = join(homedir(), ".local", "opt", "agy-acp-server");
    const helper = await helperNameIn(probable, target.isWindows).catch(() => null);
    if (helper) {
      const candidate = join(probable, helper);
      if ((await stat(candidate).catch(() => null))?.isFile()) harnessPath = candidate;
    }
    if (!harnessPath) harnessPath = await findOnPath("localharness_external" + (target.isWindows ? ".exe" : ""));
  }
  return {
    ok: binaryPath !== null,
    platform: target.platform,
    arch: target.arch,
    binaryPath,
    harnessPath,
    error: binaryPath ? null : `\`${binaryName}\` was not found on PATH. Install it with \`bb antigravity-acp install\`.`,
  };
}
