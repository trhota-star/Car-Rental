CREATE TYPE "public"."damage_severity" AS ENUM('MINOR', 'MODERATE', 'MAJOR');--> statement-breakpoint
CREATE TYPE "public"."damage_stage" AS ENUM('PICKUP', 'RETURN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."damage_status" AS ENUM('OPEN', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('PENDING', 'AUTHORIZED', 'FAILED', 'RELEASED', 'CAPTURED');--> statement-breakpoint
CREATE TYPE "public"."extra_pricing" AS ENUM('PER_DAY', 'PER_RENTAL');--> statement-breakpoint
CREATE TYPE "public"."fuel_type" AS ENUM('PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('PENDING', 'CONFIRMED', 'PICKED_UP', 'RETURNED', 'CANCELLED', 'EXPIRED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."transmission" AS ENUM('AUTOMATIC', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('CUSTOMER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('AVAILABLE', 'RESERVED', 'ON_RENT', 'MAINTENANCE', 'RETIRED');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_provider_account_uq" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"emirate" text NOT NULL,
	"address" text NOT NULL,
	"phone" text,
	"time_zone" text DEFAULT 'Asia/Dubai' NOT NULL,
	"opens_at_minute" integer DEFAULT 0 NOT NULL,
	"closes_at_minute" integer DEFAULT 1440 NOT NULL,
	"vat_rate_bp" integer DEFAULT 500 NOT NULL,
	"one_way_fee_fils" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_unique" UNIQUE("code"),
	CONSTRAINT "branches_code_format" CHECK ("branches"."code" ~ '^[A-Z0-9-]{2,12}$'),
	CONSTRAINT "branches_vat_range" CHECK ("branches"."vat_rate_bp" BETWEEN 0 AND 10000),
	CONSTRAINT "branches_one_way_fee_nonneg" CHECK ("branches"."one_way_fee_fils" >= 0),
	CONSTRAINT "branches_hours_valid" CHECK ("branches"."opens_at_minute" >= 0 AND "branches"."closes_at_minute" <= 1440 AND "branches"."opens_at_minute" < "branches"."closes_at_minute")
);
--> statement-breakpoint
CREATE TABLE "damage_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"reservation_id" uuid,
	"reported_by_id" uuid NOT NULL,
	"stage" "damage_stage" NOT NULL,
	"severity" "damage_severity" NOT NULL,
	"description" text NOT NULL,
	"image_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"repair_cost_fils" integer DEFAULT 0 NOT NULL,
	"charged_fils" integer DEFAULT 0 NOT NULL,
	"status" "damage_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "damage_reports_money" CHECK ("damage_reports"."repair_cost_fils" >= 0 AND "damage_reports"."charged_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_hold_id" text,
	"idempotency_key" text NOT NULL,
	"amount_fils" integer NOT NULL,
	"captured_fils" integer DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'AED' NOT NULL,
	"status" "deposit_status" DEFAULT 'PENDING' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_provider_hold_id_unique" UNIQUE("provider_hold_id"),
	CONSTRAINT "deposits_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "deposits_amount_positive" CHECK ("deposits"."amount_fils" > 0),
	CONSTRAINT "deposits_capture_range" CHECK ("deposits"."captured_fils" >= 0 AND "deposits"."captured_fils" <= "deposits"."amount_fils")
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"nationality" text,
	"phone" text NOT NULL,
	"licence_number" text NOT NULL,
	"licence_country" char(2) NOT NULL,
	"licence_expiry" date NOT NULL,
	"licence_file_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "driver_profiles_licence_after_dob" CHECK ("driver_profiles"."licence_expiry" > "driver_profiles"."date_of_birth"),
	CONSTRAINT "driver_profiles_country_upper" CHECK ("driver_profiles"."licence_country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "extras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"pricing" "extra_pricing" NOT NULL,
	"price_fils" integer NOT NULL,
	"max_charge_fils" integer,
	"max_quantity" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extras_code_unique" UNIQUE("code"),
	CONSTRAINT "extras_price_nonneg" CHECK ("extras"."price_fils" >= 0),
	CONSTRAINT "extras_cap_nonneg" CHECK ("extras"."max_charge_fils" IS NULL OR "extras"."max_charge_fils" >= 0),
	CONSTRAINT "extras_max_qty" CHECK ("extras"."max_quantity" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "maintenance_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"period" "tstzrange" GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED NOT NULL,
	"reason" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_blocks_period_valid" CHECK ("maintenance_blocks"."ends_at" > "maintenance_blocks"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "payment_webhook_events_uq" UNIQUE("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"idempotency_key" text NOT NULL,
	"purpose" text DEFAULT 'CHARGE' NOT NULL,
	"amount_fils" integer NOT NULL,
	"refunded_fils" integer DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'AED' NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_payment_id_unique" UNIQUE("provider_payment_id"),
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_fils" > 0),
	CONSTRAINT "payments_refund_range" CHECK ("payments"."refunded_fils" >= 0 AND "payments"."refunded_fils" <= "payments"."amount_fils"),
	CONSTRAINT "payments_purpose" CHECK ("payments"."purpose" IN ('CHARGE', 'EXTRA_CHARGE'))
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"vehicle_id" uuid,
	"branch_id" uuid,
	"daily_rate_fils" integer NOT NULL,
	"min_days" integer DEFAULT 1 NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rules_target" CHECK ("pricing_rules"."category_id" IS NOT NULL OR "pricing_rules"."vehicle_id" IS NOT NULL),
	CONSTRAINT "pricing_rules_rate_positive" CHECK ("pricing_rules"."daily_rate_fils" > 0),
	CONSTRAINT "pricing_rules_min_days" CHECK ("pricing_rules"."min_days" >= 1),
	CONSTRAINT "pricing_rules_season" CHECK ("pricing_rules"."valid_from" IS NULL OR "pricing_rules"."valid_to" IS NULL OR "pricing_rules"."valid_from" <= "pricing_rules"."valid_to")
);
--> statement-breakpoint
CREATE TABLE "rental_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"picked_up_at" timestamp with time zone NOT NULL,
	"pickup_mileage_km" integer NOT NULL,
	"pickup_fuel_percent" integer NOT NULL,
	"pickup_staff_id" uuid NOT NULL,
	"pickup_notes" text,
	"returned_at" timestamp with time zone,
	"return_mileage_km" integer,
	"return_fuel_percent" integer,
	"return_staff_id" uuid,
	"return_branch_id" uuid,
	"return_notes" text,
	"late_fee_fils" integer DEFAULT 0 NOT NULL,
	"fuel_charge_fils" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_agreements_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "rental_agreements_pickup_mileage" CHECK ("rental_agreements"."pickup_mileage_km" >= 0),
	CONSTRAINT "rental_agreements_pickup_fuel" CHECK ("rental_agreements"."pickup_fuel_percent" BETWEEN 0 AND 100),
	CONSTRAINT "rental_agreements_return_fuel" CHECK ("rental_agreements"."return_fuel_percent" IS NULL OR "rental_agreements"."return_fuel_percent" BETWEEN 0 AND 100),
	CONSTRAINT "rental_agreements_return_mileage" CHECK ("rental_agreements"."return_mileage_km" IS NULL OR "rental_agreements"."return_mileage_km" >= "rental_agreements"."pickup_mileage_km"),
	CONSTRAINT "rental_agreements_return_after_pickup" CHECK ("rental_agreements"."returned_at" IS NULL OR "rental_agreements"."returned_at" >= "rental_agreements"."picked_up_at"),
	CONSTRAINT "rental_agreements_return_complete" CHECK (("rental_agreements"."returned_at" IS NULL) = ("rental_agreements"."return_mileage_km" IS NULL)
        AND ("rental_agreements"."returned_at" IS NULL) = ("rental_agreements"."return_fuel_percent" IS NULL)
        AND ("rental_agreements"."returned_at" IS NULL) = ("rental_agreements"."return_staff_id" IS NULL)),
	CONSTRAINT "rental_agreements_fees_nonneg" CHECK ("rental_agreements"."late_fee_fils" >= 0 AND "rental_agreements"."fuel_charge_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservation_extras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"extra_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"pricing" "extra_pricing" NOT NULL,
	"unit_price_fils" integer NOT NULL,
	"total_fils" integer NOT NULL,
	CONSTRAINT "reservation_extras_uq" UNIQUE("reservation_id","extra_id"),
	CONSTRAINT "reservation_extras_qty" CHECK ("reservation_extras"."quantity" BETWEEN 1 AND 10),
	CONSTRAINT "reservation_extras_money" CHECK ("reservation_extras"."unit_price_fils" >= 0 AND "reservation_extras"."total_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"pickup_branch_id" uuid NOT NULL,
	"return_branch_id" uuid NOT NULL,
	"pickup_at" timestamp with time zone NOT NULL,
	"return_at" timestamp with time zone NOT NULL,
	"period" "tstzrange" GENERATED ALWAYS AS (tstzrange(pickup_at, return_at, '[)')) STORED NOT NULL,
	"status" "reservation_status" DEFAULT 'PENDING' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"driver_name" text NOT NULL,
	"driver_email" text NOT NULL,
	"driver_phone" text NOT NULL,
	"driver_profile_id" uuid,
	"currency" char(3) DEFAULT 'AED' NOT NULL,
	"rental_days" integer NOT NULL,
	"daily_rate_fils" integer NOT NULL,
	"base_fils" integer NOT NULL,
	"extras_fils" integer DEFAULT 0 NOT NULL,
	"one_way_fee_fils" integer DEFAULT 0 NOT NULL,
	"subtotal_fils" integer NOT NULL,
	"vat_rate_bp" integer NOT NULL,
	"vat_fils" integer NOT NULL,
	"total_fils" integer NOT NULL,
	"deposit_fils" integer DEFAULT 0 NOT NULL,
	"late_fee_fils" integer DEFAULT 0 NOT NULL,
	"cancellation_fee_fils" integer DEFAULT 0 NOT NULL,
	"refunded_fils" integer DEFAULT 0 NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_reference_unique" UNIQUE("reference"),
	CONSTRAINT "reservations_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "reservations_period_valid" CHECK ("reservations"."return_at" > "reservations"."pickup_at"),
	CONSTRAINT "reservations_pending_has_hold" CHECK ("reservations"."status" <> 'PENDING' OR "reservations"."hold_expires_at" IS NOT NULL),
	CONSTRAINT "reservations_days_positive" CHECK ("reservations"."rental_days" >= 1),
	CONSTRAINT "reservations_vat_range" CHECK ("reservations"."vat_rate_bp" BETWEEN 0 AND 10000),
	CONSTRAINT "reservations_money_nonneg" CHECK ("reservations"."daily_rate_fils" >= 0 AND "reservations"."base_fils" >= 0 AND "reservations"."extras_fils" >= 0 AND "reservations"."one_way_fee_fils" >= 0
        AND "reservations"."subtotal_fils" >= 0 AND "reservations"."vat_fils" >= 0 AND "reservations"."total_fils" >= 0 AND "reservations"."deposit_fils" >= 0
        AND "reservations"."late_fee_fils" >= 0 AND "reservations"."cancellation_fee_fils" >= 0 AND "reservations"."refunded_fils" >= 0),
	CONSTRAINT "reservations_totals_consistent" CHECK ("reservations"."subtotal_fils" = "reservations"."base_fils" + "reservations"."extras_fils" + "reservations"."one_way_fee_fils" AND "reservations"."total_fils" = "reservations"."subtotal_fils" + "reservations"."vat_fils"),
	CONSTRAINT "reservations_refund_le_total" CHECK ("reservations"."refunded_fils" <= "reservations"."total_fils"),
	CONSTRAINT "reservations_currency_format" CHECK ("reservations"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'CUSTOMER' NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicle_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"security_deposit_fils" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_categories_code_unique" UNIQUE("code"),
	CONSTRAINT "vehicle_categories_deposit_nonneg" CHECK ("vehicle_categories"."security_deposit_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vehicle_feature_map" (
	"vehicle_id" uuid NOT NULL,
	"feature_id" uuid NOT NULL,
	CONSTRAINT "vehicle_feature_map_vehicle_id_feature_id_pk" PRIMARY KEY("vehicle_id","feature_id")
);
--> statement-breakpoint
CREATE TABLE "vehicle_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_features_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"plate_number" text NOT NULL,
	"vin" char(17) NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"color" text,
	"transmission" "transmission" NOT NULL,
	"fuel_type" "fuel_type" NOT NULL,
	"seats" integer NOT NULL,
	"doors" integer DEFAULT 4 NOT NULL,
	"luggage" integer DEFAULT 2 NOT NULL,
	"mileage_km" integer DEFAULT 0 NOT NULL,
	"status" "vehicle_status" DEFAULT 'AVAILABLE' NOT NULL,
	"image_url" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_plate_number_unique" UNIQUE("plate_number"),
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin"),
	CONSTRAINT "vehicles_vin_format" CHECK ("vehicles"."vin" ~ '^[A-HJ-NPR-Z0-9]{17}$'),
	CONSTRAINT "vehicles_year_range" CHECK ("vehicles"."year" BETWEEN 1990 AND 2100),
	CONSTRAINT "vehicles_seats_range" CHECK ("vehicles"."seats" BETWEEN 1 AND 15),
	CONSTRAINT "vehicles_doors_range" CHECK ("vehicles"."doors" BETWEEN 2 AND 6),
	CONSTRAINT "vehicles_luggage_nonneg" CHECK ("vehicles"."luggage" >= 0),
	CONSTRAINT "vehicles_mileage_nonneg" CHECK ("vehicles"."mileage_km" >= 0)
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_pickup_staff_id_users_id_fk" FOREIGN KEY ("pickup_staff_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_return_staff_id_users_id_fk" FOREIGN KEY ("return_staff_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_return_branch_id_branches_id_fk" FOREIGN KEY ("return_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_extras" ADD CONSTRAINT "reservation_extras_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_extras" ADD CONSTRAINT "reservation_extras_extra_id_extras_id_fk" FOREIGN KEY ("extra_id") REFERENCES "public"."extras"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_pickup_branch_id_branches_id_fk" FOREIGN KEY ("pickup_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_return_branch_id_branches_id_fk" FOREIGN KEY ("return_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_driver_profile_id_driver_profiles_id_fk" FOREIGN KEY ("driver_profile_id") REFERENCES "public"."driver_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_feature_map" ADD CONSTRAINT "vehicle_feature_map_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_feature_map" ADD CONSTRAINT "vehicle_feature_map_feature_id_vehicle_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."vehicle_features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "damage_reports_vehicle_idx" ON "damage_reports" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "damage_reports_reservation_idx" ON "damage_reports" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "deposits_reservation_idx" ON "deposits" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "maintenance_blocks_vehicle_idx" ON "maintenance_blocks" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "payments_reservation_idx" ON "payments" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "pricing_rules_category_idx" ON "pricing_rules" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "pricing_rules_vehicle_idx" ON "pricing_rules" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "rental_agreements_vehicle_idx" ON "rental_agreements" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "reservation_extras_extra_idx" ON "reservation_extras" USING btree ("extra_id");--> statement-breakpoint
CREATE INDEX "reservations_user_idx" ON "reservations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reservations_vehicle_idx" ON "reservations" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "reservations_status_idx" ON "reservations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reservations_hold_expiry_idx" ON "reservations" USING btree ("hold_expires_at") WHERE "reservations"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "reservations_pickup_branch_idx" ON "reservations" USING btree ("pickup_branch_id","pickup_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "vehicle_feature_map_feature_idx" ON "vehicle_feature_map" USING btree ("feature_id");--> statement-breakpoint
CREATE INDEX "vehicles_branch_idx" ON "vehicles" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "vehicles_category_idx" ON "vehicles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "vehicles_status_idx" ON "vehicles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");