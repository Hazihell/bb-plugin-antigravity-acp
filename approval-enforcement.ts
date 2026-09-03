// Declare provider-side approval enforcement on the canonical ACP bridge.
//
// bb marks every turn that a human did not start (an agent's `bb thread
// tell`, a system message, a Goal clear) with permission escalation "deny".
// For bridges whose handshake says approvals are enforced by the runtime,
// the daemon then answers every approval request in such a turn with an
// automatic deny instead of raising an interaction. Antigravity persists the
// first deny as a session-wide wildcard rule ("Denied by user (*)"), so one
// steered turn leaves the whole session unable to run commands or read files.
//
// The ACP bridge already enforces the thread's permission mode before it
// forwards a request (full mode allows in place; anything else asks), which
// is exactly the contract "provider" enforcement describes. Reporting it as
// such makes the runtime raise the interaction to the user or parent thread
// rather than auto-deny it. Only the `initialize` reply is rewritten.

type Writable = { write: (chunk: unknown, ...rest: unknown[]) => boolean };

type BridgeLike = {
  handleLine: (line: string) => void;
  [key: string]: unknown;
};

export const PROVIDER_ENFORCED = "provider";

export function rewriteInitializeReply(line: string, pendingInitializeIds: Set<string | number>): string {
  if (pendingInitializeIds.size === 0) return line;
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return line;
  let message: { id?: string | number; result?: { capabilities?: Record<string, unknown> } };
  try {
    message = JSON.parse(trimmed);
  } catch {
    return line;
  }
  const id = message.id;
  if (id === undefined || !pendingInitializeIds.has(id)) return line;
  pendingInitializeIds.delete(id);
  const capabilities = message.result?.capabilities;
  if (!capabilities || typeof capabilities !== "object") return line;
  capabilities.approvalEnforcedBy = PROVIDER_ENFORCED;
  return JSON.stringify(message) + "\n";
}

export function noteInitializeRequest(line: string, pendingInitializeIds: Set<string | number>): void {
  const trimmed = line.trim();
  if (!trimmed.includes('"initialize"')) return;
  try {
    const message = JSON.parse(trimmed) as { id?: string | number; method?: string };
    if (message.method === "initialize" && message.id !== undefined) pendingInitializeIds.add(message.id);
  } catch {
    // Not JSON; the bridge will report the parse problem itself.
  }
}

export function withProviderEnforcedApprovals<T extends BridgeLike>(bridge: T, out: Writable = process.stdout): T {
  const pendingInitializeIds = new Set<string | number>();
  const originalWrite = out.write.bind(out);
  out.write = ((chunk: unknown, ...rest: unknown[]) => {
    const rewritten = typeof chunk === "string" ? rewriteInitializeReply(chunk, pendingInitializeIds) : chunk;
    return originalWrite(rewritten, ...rest);
  }) as Writable["write"];
  return {
    ...bridge,
    handleLine: (line: string) => {
      noteInitializeRequest(line, pendingInitializeIds);
      bridge.handleLine(line);
    },
  };
}
