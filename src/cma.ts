import Anthropic from "@anthropic-ai/sdk";
import { config } from "./env.js";
import { SessionStore } from "./session-store.js";

// Zero-arg client resolves credentials from ANTHROPIC_API_KEY,
// ANTHROPIC_AUTH_TOKEN, or the active `ant auth login` profile.
const client = new Anthropic();

const store = new SessionStore(".data/sessions.json");

/** Errors that mean the stored session is gone or unusable — recreate it. */
function isStaleSessionError(err: unknown): boolean {
  return (
    err instanceof Anthropic.APIError &&
    typeof err.status === "number" &&
    [404, 409, 410].includes(err.status)
  );
}

async function createSession(title: string): Promise<string> {
  const session = await client.beta.sessions.create({
    agent: config.agentId,
    environment_id: config.environmentId,
    title,
  });
  console.log(
    `[cma] session ${session.id} — trace: https://platform.claude.com/workspaces/default/sessions/${session.id}`,
  );
  return session.id;
}

/**
 * Run one conversational turn against the Managed Agent and yield reply text
 * as it arrives (one chunk per buffered `agent.message` event).
 *
 * Stream-first ordering: the SSE stream is opened before the user message is
 * sent, so no events are missed. The loop breaks on a terminal
 * `session.status_idle` (anything except `requires_action`) or
 * `session.status_terminated` — see the Managed Agents client patterns.
 */
export async function* managedTurn(args: {
  conversationKey: string;
  title: string;
  prompt: string;
}): AsyncGenerator<string> {
  let sessionId = store.get(args.conversationKey);
  let freshlyCreated = false;
  if (!sessionId) {
    sessionId = await createSession(args.title);
    store.set(args.conversationKey, sessionId);
    freshlyCreated = true;
  }

  const openTurn = async (id: string) => {
    const stream = await client.beta.sessions.events.stream(id);
    try {
      await client.beta.sessions.events.send(id, {
        events: [
          { type: "user.message", content: [{ type: "text", text: args.prompt }] },
        ],
      });
    } catch (err) {
      stream.controller.abort();
      throw err;
    }
    return stream;
  };

  let stream: Awaited<ReturnType<typeof openTurn>>;
  try {
    stream = await openTurn(sessionId);
  } catch (err) {
    if (freshlyCreated || !isStaleSessionError(err)) throw err;
    // Stored session no longer usable (deleted/terminated) — start a new one.
    sessionId = await createSession(args.title);
    store.set(args.conversationKey, sessionId);
    stream = await openTurn(sessionId);
  }

  const timeout = setTimeout(() => stream.controller.abort(), config.turnTimeoutMs);
  let emitted = false;
  try {
    for await (const event of stream) {
      switch (event.type) {
        case "agent.message": {
          const text = event.content
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("")
            .trim();
          if (text) {
            yield emitted ? `\n\n${text}` : text;
            emitted = true;
          }
          break;
        }
        case "session.error": {
          console.error(`[cma] session ${sessionId} error event`, event);
          yield emitted
            ? "\n\n_Something went wrong while finishing that up._"
            : "_Something went wrong while working on that. Please try again._";
          return;
        }
        case "session.status_idle": {
          if (event.stop_reason.type === "requires_action") {
            // No custom tools or always_ask policies are configured, so this
            // indicates config drift; break rather than deadlock the handler.
            console.warn(`[cma] session ${sessionId} unexpectedly requires_action`);
          }
          return;
        }
        case "session.status_terminated": {
          store.delete(args.conversationKey);
          return;
        }
        default:
          break;
      }
    }
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) {
      console.warn(`[cma] session ${sessionId} turn timed out`);
      yield emitted
        ? "\n\n_I ran out of time finishing that — ask me to continue if you'd like more._"
        : "_That took longer than I allow for one reply. Try a narrower question._";
      return;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    stream.controller.abort();
  }
}
