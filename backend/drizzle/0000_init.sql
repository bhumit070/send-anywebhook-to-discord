CREATE TYPE "public"."attempt_stage" AS ENUM('render', 'send');--> statement-breakpoint
CREATE TYPE "public"."attempt_trigger" AS ENUM('worker', 'manual', 'replay');--> statement-breakpoint
CREATE TYPE "public"."queue_status" AS ENUM('pending', 'processing', 'delivered', 'failed', 'dead', 'skipped', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."sample_source" AS ENUM('example', 'schema', 'captured');--> statement-breakpoint
CREATE TYPE "public"."template_mode" AS ENUM('mapping', 'liquid');--> statement-breakpoint
CREATE TABLE "relays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"ingest_key" text NOT NULL,
	"discord_webhook_url_enc" text NOT NULL,
	"sample_payload" jsonb,
	"sample_source" "sample_source",
	"capture_mode" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"relay_id" uuid NOT NULL,
	"name" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"condition" text,
	"mode" "template_mode" DEFAULT 'mapping' NOT NULL,
	"mapping" jsonb,
	"message" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"trigger" "attempt_trigger" NOT NULL,
	"stage" "attempt_stage" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer,
	"request_body" jsonb,
	"response_status" integer,
	"response_headers" jsonb,
	"response_body" text,
	"error_message" text,
	"error_stack" text
);
--> statement-breakpoint
CREATE TABLE "webhook_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"relay_id" uuid,
	"status" "queue_status" DEFAULT 'pending' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_ip" text,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb,
	"template_id" uuid,
	"rendered" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	"last_status_code" integer
);
--> statement-breakpoint
ALTER TABLE "relays" ADD CONSTRAINT "relays_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_relay_id_relays_id_fk" FOREIGN KEY ("relay_id") REFERENCES "public"."relays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_attempts" ADD CONSTRAINT "webhook_attempts_queue_id_webhook_queue_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."webhook_queue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_queue" ADD CONSTRAINT "webhook_queue_relay_id_relays_id_fk" FOREIGN KEY ("relay_id") REFERENCES "public"."relays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_queue" ADD CONSTRAINT "webhook_queue_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "relays_ingest_key_idx" ON "relays" USING btree ("ingest_key");--> statement-breakpoint
CREATE INDEX "relays_user_id_idx" ON "relays" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "templates_relay_id_idx" ON "templates" USING btree ("relay_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "webhook_attempts_queue_idx" ON "webhook_attempts" USING btree ("queue_id","attempt_no");--> statement-breakpoint
CREATE INDEX "webhook_queue_claim_idx" ON "webhook_queue" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_queue_relay_received_idx" ON "webhook_queue" USING btree ("relay_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "webhook_queue_received_idx" ON "webhook_queue" USING btree ("received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "webhook_queue_payload_gin_idx" ON "webhook_queue" USING gin ("payload" jsonb_path_ops);