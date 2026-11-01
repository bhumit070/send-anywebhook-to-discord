import { isDiscordWebhookUrl } from '@send-any-webhook/shared';
import { and, eq } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { discordWebhooks } from '../db/schema.js';
import { decrypt, deriveKey, encrypt } from '../lib/crypto.js';
import { maskWebhookUrl } from '../lib/discord.js';

export const BAD_WEBHOOK_URL = 'Not a Discord webhook URL. Copy it from Channel settings → Integrations → Webhooks.';

/** How a relay chooses its Discord webhook: a saved one, or a URL to save (reused if already saved). */
export interface WebhookChoice {
  discordWebhookId?: string;
  discordWebhookUrl?: string;
  discordWebhookName?: string;
}

export class DiscordWebhookStore {
  private readonly key: Buffer;

  constructor(
    private readonly db: Db,
    config: Config,
  ) {
    this.key = deriveKey(config.appSecret, 'webhook-url');
  }

  encrypt(url: string) {
    return encrypt(this.key, url.trim());
  }

  decrypt(enc: string) {
    return decrypt(this.key, enc);
  }

  /** Masked URL for display; never returns the token. */
  masked(enc: string): string {
    try {
      return maskWebhookUrl(this.decrypt(enc));
    } catch {
      return 'https://discord.com/api/webhooks/…'; // APP_SECRET changed; re-enter the URL
    }
  }

  async owned(userId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(discordWebhooks)
      .where(and(eq(discordWebhooks.id, id), eq(discordWebhooks.userId, userId)));
    return row;
  }

  /** URLs are encrypted with a random IV, so finding a duplicate means decrypting the user's list. */
  async findByUrl(userId: string, url: string) {
    const rows = await this.db.select().from(discordWebhooks).where(eq(discordWebhooks.userId, userId));
    return rows.find((r) => {
      try {
        return this.decrypt(r.urlEnc) === url.trim();
      } catch {
        return false;
      }
    });
  }

  /**
   * Resolves a relay's webhook choice to a saved webhook id, saving a new URL when needed.
   * Returns an error message for the client instead of throwing.
   */
  async resolve(userId: string, choice: WebhookChoice, fallbackName: string): Promise<{ id: string } | { error: string }> {
    if (choice.discordWebhookId) {
      return (await this.owned(userId, choice.discordWebhookId)) ? { id: choice.discordWebhookId } : { error: 'Saved Discord webhook not found' };
    }
    const url = choice.discordWebhookUrl?.trim();
    if (!url) return { error: 'Choose a saved Discord webhook or paste a webhook URL' };
    if (!isDiscordWebhookUrl(url)) return { error: BAD_WEBHOOK_URL };
    const existing = await this.findByUrl(userId, url);
    if (existing) return { id: existing.id };
    const [row] = await this.db
      .insert(discordWebhooks)
      .values({ userId, name: choice.discordWebhookName?.trim() || fallbackName, urlEnc: this.encrypt(url) })
      .returning({ id: discordWebhooks.id });
    return { id: row!.id };
  }
}
