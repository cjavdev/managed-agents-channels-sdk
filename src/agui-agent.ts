import { randomUUID } from "node:crypto";
import { Observable } from "rxjs";
import { AbstractAgent } from "@ag-ui/client";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { managedTurn } from "./cma.js";

/**
 * AG-UI adapter over the Managed Agent bridge. Registered as the runtime's
 * `agents.default` (the runtime requires a non-empty agent map even for a
 * channels-only service), and usable as a `createChannel({ agent })` if the
 * built-in `thread.runAgent()` loop is ever wanted. Each AG-UI thread maps to
 * one Managed Agent session, so conversation memory lives server-side.
 */
export class ManagedAgentBridge extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const abort = new AbortController();

      void (async () => {
        subscriber.next({
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        } as BaseEvent);

        const lastUser = [...input.messages]
          .reverse()
          .find((m) => m.role === "user");
        const prompt =
          typeof lastUser?.content === "string" ? lastUser.content.trim() : "";

        if (prompt) {
          const messageId = randomUUID();
          let started = false;
          for await (const chunk of managedTurn({
            conversationKey: `agui-${input.threadId}`,
            title: prompt.slice(0, 60),
            prompt,
          })) {
            if (abort.signal.aborted) return;
            if (!started) {
              subscriber.next({
                type: EventType.TEXT_MESSAGE_START,
                messageId,
                role: "assistant",
              } as BaseEvent);
              started = true;
            }
            subscriber.next({
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId,
              delta: chunk,
            } as BaseEvent);
          }
          if (started) {
            subscriber.next({
              type: EventType.TEXT_MESSAGE_END,
              messageId,
            } as BaseEvent);
          }
        }

        subscriber.next({
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
        } as BaseEvent);
        subscriber.complete();
      })().catch((err) => subscriber.error(err));

      return () => abort.abort();
    });
  }

  clone(): ManagedAgentBridge {
    return new ManagedAgentBridge({
      agentId: this.agentId,
      description: this.description,
      threadId: this.threadId,
      initialMessages: this.messages,
      initialState: this.state,
    });
  }
}
