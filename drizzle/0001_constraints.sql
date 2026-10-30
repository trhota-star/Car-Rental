-- Custom migration: what Drizzle cannot express.
-- 1. btree_gist (needed to mix "=" on uuid with "&&" on ranges in one GiST exclusion).
-- 2. Exclusion constraints: no overlapping ACTIVE reservations per vehicle, no overlapping
--    (non-cancelled) maintenance blocks per vehicle. Periods are half-open [) so back-to-back is fine.
-- 3. Cross-table rule (reservation vs maintenance block) via triggers. An exclusion constraint
--    cannot span two tables, so each trigger first takes a row lock on the vehicle
--    (SELECT ... FOR UPDATE), which serialises every writer for that vehicle, then checks the
--    other table. The reservation service already holds the same lock, so this adds no extra
--    contention on the booking path. Violations raise SQLSTATE 23P01 (exclusion_violation), the
--    same code as the exclusion constraints, so services map both to VEHICLE_UNAVAILABLE.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_no_overlap"
  EXCLUDE USING gist ("vehicle_id" WITH =, "period" WITH &&)
  WHERE ("status" IN ('PENDING', 'CONFIRMED', 'PICKED_UP'));
--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_no_overlap"
  EXCLUDE USING gist ("vehicle_id" WITH =, "period" WITH &&)
  WHERE ("cancelled_at" IS NULL);
--> statement-breakpoint
CREATE INDEX "reservations_vehicle_period_gist" ON "reservations" USING gist ("vehicle_id", "period");
--> statement-breakpoint
CREATE INDEX "maintenance_blocks_vehicle_period_gist" ON "maintenance_blocks" USING gist ("vehicle_id", "period");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION de_reservation_vs_maintenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('PENDING', 'CONFIRMED', 'PICKED_UP') THEN
    PERFORM 1 FROM vehicles WHERE id = NEW.vehicle_id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM maintenance_blocks m
       WHERE m.vehicle_id = NEW.vehicle_id
         AND m.cancelled_at IS NULL
         AND m.period && tstzrange(NEW.pickup_at, NEW.return_at, '[)')
    ) THEN
      RAISE EXCEPTION 'vehicle % has a maintenance block overlapping this reservation', NEW.vehicle_id
        USING ERRCODE = '23P01', CONSTRAINT = 'reservations_no_maintenance_overlap';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "reservations_no_maintenance_overlap"
  BEFORE INSERT OR UPDATE OF "status", "pickup_at", "return_at", "vehicle_id" ON "reservations"
  FOR EACH ROW EXECUTE FUNCTION de_reservation_vs_maintenance();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION de_maintenance_vs_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cancelled_at IS NULL THEN
    PERFORM 1 FROM vehicles WHERE id = NEW.vehicle_id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM reservations r
       WHERE r.vehicle_id = NEW.vehicle_id
         AND r.status IN ('PENDING', 'CONFIRMED', 'PICKED_UP')
         AND r.period && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
    ) THEN
      RAISE EXCEPTION 'vehicle % has an active reservation overlapping this maintenance block', NEW.vehicle_id
        USING ERRCODE = '23P01', CONSTRAINT = 'maintenance_blocks_no_reservation_overlap';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "maintenance_blocks_no_reservation_overlap"
  BEFORE INSERT OR UPDATE OF "starts_at", "ends_at", "cancelled_at", "vehicle_id" ON "maintenance_blocks"
  FOR EACH ROW EXECUTE FUNCTION de_maintenance_vs_reservation();
