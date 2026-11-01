ALTER TABLE "relays" ALTER COLUMN "discord_webhook_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "relays" DROP COLUMN "discord_webhook_url_enc";