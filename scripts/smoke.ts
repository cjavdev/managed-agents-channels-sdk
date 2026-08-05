/**
 * Smoke test: exercises the real Managed Agent (no Slack, no canned
 * responses). Creates a throwaway session, sends one message, and verifies a
 * non-empty model-generated reply streams back.
 *
 *   npm run smoke
 */
import { managedTurn } from "../src/cma.js";

const conversationKey = `smoke-${process.pid}-${Date.now()}`;

console.log(`[smoke] running one turn on conversation ${conversationKey}`);
let reply = "";
for await (const chunk of managedTurn({
  conversationKey,
  title: "Bridge smoke test",
  prompt:
    "This is an automated smoke test of the Slack bridge. Reply with one short sentence confirming you are online. Do not use any tools.",
})) {
  process.stdout.write(chunk);
  reply += chunk;
}
console.log("\n---");

if (!reply.trim()) {
  console.error("[smoke] FAIL — empty reply");
  process.exit(1);
}
console.log("[smoke] PASS");
