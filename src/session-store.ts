import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Maps a channel conversation key (one Slack thread) to its Managed Agent
 * session ID. Sessions are persistent server-side, so persisting the mapping
 * lets a restarted process continue existing threads with full context.
 */
export class SessionStore {
  private map = new Map<string, string>();

  constructor(private readonly filePath: string) {
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, string>;
      this.map = new Map(Object.entries(raw));
    } catch {
      // First boot or unreadable file — start empty.
    }
  }

  get(conversationKey: string): string | undefined {
    return this.map.get(conversationKey);
  }

  set(conversationKey: string, sessionId: string): void {
    this.map.set(conversationKey, sessionId);
    this.flush();
  }

  delete(conversationKey: string): void {
    this.map.delete(conversationKey);
    this.flush();
  }

  private flush(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map), null, 2));
    renameSync(tmp, this.filePath);
  }
}
