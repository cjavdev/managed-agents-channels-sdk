import "dotenv/config";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  /** Managed Agent that answers Slack threads (created via cma/agent.yaml). */
  agentId: requireEnv("CMA_AGENT_ID"),
  /** Cloud environment the agent's tools execute in (cma/environment.yaml). */
  environmentId: requireEnv("CMA_ENVIRONMENT_ID"),
  /** Channel code — must match the `--name` used with `copilotkit channels add`. */
  channelName: process.env.CHANNEL_NAME ?? "cma-assistant",
  port: Number(process.env.PORT ?? 4111),
  /** Hard ceiling on one Slack turn so a wedged session can't hang the handler. */
  turnTimeoutMs: Number(process.env.CMA_TURN_TIMEOUT_MS ?? 5 * 60_000),
};
