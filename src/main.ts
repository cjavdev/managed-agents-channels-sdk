import { createServer } from "node:http";
import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import { buildChannel } from "./channel.js";
import { ManagedAgentBridge } from "./agui-agent.js";
import { config, requireEnv } from "./env.js";

const channel = buildChannel();

// `copilotkit init` writes INTELLIGENCE_API_KEY; COPILOTKIT_API_KEY is the
// documented fallback name. The realtime plane is a different host from the
// API plane and is not derived from it — pass it through when the project's
// environment contract provides one.
const intelligenceApiKey =
  process.env.INTELLIGENCE_API_KEY ?? requireEnv("COPILOTKIT_API_KEY");
const wsUrl =
  process.env.INTELLIGENCE_GATEWAY_WS_URL ??
  process.env.COPILOTKIT_INTELLIGENCE_WS_URL;

const runtime = new CopilotRuntime({
  // The runtime requires a non-empty agent map; `default` is the same
  // Managed Agent, exposed through the AG-UI adapter.
  agents: { default: new ManagedAgentBridge() },
  intelligence: new CopilotKitIntelligence({
    apiKey: intelligenceApiKey,
    ...(wsUrl ? { wsUrl } : {}),
  }),
  channels: [channel] as const,
});

// Creating the listener starts channel activation (opens the Realtime Gateway
// socket for the managed Slack transport).
const listener = createCopilotNodeListener({ runtime });
const server = createServer(listener);
server.listen(config.port, () => {
  console.log(`[main] listening on :${config.port}`);
});

async function shutdown(signal: string) {
  console.log(`[main] ${signal} — shutting down`);
  try {
    await listener.channels.stop();
  } finally {
    server.close(() => process.exit(0));
    // Fallback if in-flight sockets keep the server open.
    setTimeout(() => process.exit(0), 5_000).unref();
  }
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await listener.channels.ready({ timeoutMs: 60_000 });
  const status = listener.channels.status();
  console.log(
    `[main] channels ${status.overall} — ${JSON.stringify(status.channels)}`,
  );
  if (status.channels[config.channelName] !== "online") {
    console.warn(
      `[main] channel "${config.channelName}" is not online yet — run \`npx copilotkit@latest channels status --json\` for diagnostics`,
    );
  }
} catch (err) {
  console.error("[main] channel activation failed", err);
  process.exitCode = 1;
  await shutdown("activation-failure");
}
