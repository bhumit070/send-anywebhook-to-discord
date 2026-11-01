import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordSender } from '../lib/discord.js';
import type { Delivery } from '../services/delivery.js';

export interface RouteDeps {
  config: Config;
  db: Db;
  delivery: Delivery;
  send: DiscordSender;
}
