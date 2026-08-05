import { createChannel } from "@copilotkit/channels";
import type { Channel, ChannelHandler } from "@copilotkit/channels";
import { config } from "./env.js";
import { managedTurn } from "./cma.js";

type HandlerCtx = Parameters<ChannelHandler>[0];

/**
 * One turn: feed the inbound Slack message to the Managed Agent session for
 * this thread and stream the reply back into Slack as it arrives.
 */
async function respond({ thread, message }: HandlerCtx): Promise<void> {
  const prompt = message.text?.trim();
  if (!prompt) return;

  try {
    await thread.stream(
      managedTurn({
        conversationKey: thread.conversationKey,
        title: prompt.slice(0, 60),
        prompt,
      }),
    );
  } catch (err) {
    // Keep the visible reply short and free of internals, per the guide.
    console.error("[channel] turn failed", err);
    await thread.post("Sorry — I hit an error handling that. Please try again.");
  }
}

export function buildChannel(): Channel {
  const channel = createChannel({
    name: config.channelName,
    identifyUser: "platform",
    // Managed Agent sessions process events in order; keep Slack turns on one
    // thread serial too so replies land in the order questions were asked.
    store: { concurrency: "serial" },
  });

  // A mention subscribes the thread, then runs the agent.
  channel.onMention(async (ctx) => {
    await ctx.thread.subscribe();
    await respond(ctx);
  });

  // Unmentioned messages only get replies in threads we're subscribed to;
  // fresh conversations stay silent until the bot is mentioned.
  channel.onMessage(async (ctx) => {
    if (!(await ctx.thread.isSubscribed())) return;
    await respond(ctx);
  });

  return channel;
}
