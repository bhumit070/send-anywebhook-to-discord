CREATE TABLE "discord_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "relays" ADD COLUMN "discord_webhook_id" uuid;--> statement-breakpoint
ALTER TABLE "discord_webhooks" ADD CONSTRAINT "discord_webhooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discord_webhooks_user_id_idx" ON "discord_webhooks" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "relays" ADD CONSTRAINT "relays_discord_webhook_id_discord_webhooks_id_fk" FOREIGN KEY ("discord_webhook_id") REFERENCES "public"."discord_webhooks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "relays_discord_webhook_id_idx" ON "relays" USING btree ("discord_webhook_id");--> statement-breakpoint
-- Data: each relay's own Discord URL becomes a saved webhook named after the relay (same id, to link them)
INSERT INTO "discord_webhooks" ("id", "user_id", "name", "url_enc") SELECT "id", "user_id", "name", "discord_webhook_url_enc" FROM "relays";--> statement-breakpoint
UPDATE "relays" SET "discord_webhook_id" = "id" WHERE "discord_webhook_id" IS NULL;
