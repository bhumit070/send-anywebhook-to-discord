import type { DiscordMessage, Mapping, MessageTemplate, RenderWarning } from '@send-any-webhook/shared';
import type { paths } from './schema';

type Json<P extends keyof paths, M extends keyof paths[P], S extends number = 200> = paths[P][M] extends {
  responses: { [K in S]: { content: { 'application/json': infer T } } };
}
  ? T
  : never;

export type Relay = Json<'/api/relays', 'get'>[number];
export type RelayDetail = Json<'/api/relays/{id}', 'get'>;
export type QueueList = Json<'/api/queue', 'get'>;
export type QueueItem = QueueList['items'][number];
export type QueueStats = Json<'/api/queue/stats', 'get'>;
export type AppConfig = Json<'/api/config', 'get'>;
export type User = Json<'/api/auth/me', 'get'>;

type QueueDetailRaw = Json<'/api/queue/{id}', 'get'>;
export type QueueDetail = Omit<QueueDetailRaw, 'rendered'> & { rendered: DiscordMessage | null };
export type Attempt = QueueDetail['attemptsLog'][number];

type TemplateRaw = Json<'/api/relays/{id}/templates', 'get'>[number];
export type Template = Omit<TemplateRaw, 'mapping' | 'message'> & { mapping: Mapping | null; message: MessageTemplate };

export type QueueStatus = QueueItem['status'];
export const QUEUE_STATUSES: QueueStatus[] = ['pending', 'processing', 'delivered', 'failed', 'dead', 'skipped', 'rejected'];

export interface TestResult {
  ok: boolean;
  status: number | null;
  error: string | null;
  render: { message: DiscordMessage | null; warnings: RenderWarning[]; error: string | null };
}
