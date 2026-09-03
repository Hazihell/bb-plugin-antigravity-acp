import assert from "node:assert/strict";
import test from "node:test";
import { withProviderEnforcedApprovals } from "../approval-enforcement.ts";

function fakeBridge(sink) {
  return {
    experimental_apiVersion: 1,
    handleLine(line) {
      const message = JSON.parse(line);
      if (message.method === "initialize") {
        sink.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true, protocolVersion: 1, capabilities: { approvalEnforcedBy: "runtime", fork: "tip" } } }) + "\n");
      } else {
        sink.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { echoed: message.method, capabilities: { approvalEnforcedBy: "runtime" } } }) + "\n");
      }
    },
  };
}

test("rewrites only the initialize reply to provider-enforced approvals", () => {
  const lines = [];
  const sink = { write: (chunk) => (lines.push(chunk), true) };
  const bridge = withProviderEnforcedApprovals(fakeBridge(sink), sink);
  assert.equal(bridge.experimental_apiVersion, 1);

  bridge.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "initialize", params: {} }));
  bridge.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 8, method: "thread/start", params: {} }));
  bridge.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "thread/start", params: {} }));

  assert.equal(lines.length, 3);
  const init = JSON.parse(lines[0]);
  assert.equal(init.result.capabilities.approvalEnforcedBy, "provider");
  assert.equal(init.result.capabilities.fork, "tip");
  assert.ok(lines[0].endsWith("\n"));
  assert.equal(JSON.parse(lines[1]).result.capabilities.approvalEnforcedBy, "runtime");
  assert.equal(JSON.parse(lines[2]).result.capabilities.approvalEnforcedBy, "runtime", "a reused id after the reply is left alone");
});

test("passes non-JSON and unrelated chunks through untouched", () => {
  const lines = [];
  const sink = { write: (chunk) => (lines.push(chunk), true) };
  withProviderEnforcedApprovals(fakeBridge(sink), sink);
  sink.write("not json\n");
  sink.write(Buffer.from("bytes"));
  assert.equal(lines[0], "not json\n");
  assert.ok(Buffer.isBuffer(lines[1]));
});
