CREATE TYPE "public"."ingest_auth_type" AS ENUM('none', 'token', 'basic', 'hmac');--> statement-breakpoint
ALTER TABLE "relays" ADD COLUMN "auth_type" "ingest_auth_type" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "relays" ADD COLUMN "auth_config_enc" text;