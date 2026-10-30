CREATE TABLE "fake_payment_provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "fake_payment_provider_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fake_payment_provider_idempotency" (
	"key" text PRIMARY KEY NOT NULL,
	"object_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fake_payment_provider_objects" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "needs_attention_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "needs_attention_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "fake_payment_provider_events_seq_idx" ON "fake_payment_provider_events" USING btree ("seq");