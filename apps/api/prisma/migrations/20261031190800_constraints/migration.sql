-- Invariants Prisma's schema language can't express. The database enforces them even
-- if a service-layer check is missing or two requests race each other.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─── time_entries ───────────────────────────────────────────────────────────────

-- Duration is always derived from the two UTC instants; nobody can write it.
-- NULL while the timer is running.
ALTER TABLE "time_entries" DROP COLUMN "duration_seconds";
ALTER TABLE "time_entries"
  ADD COLUMN "duration_seconds" INTEGER
  GENERATED ALWAYS AS ((EXTRACT(EPOCH FROM ("ended_at" - "started_at")))::integer) STORED;

ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_ended_after_started"
  CHECK ("ended_at" IS NULL OR "ended_at" > "started_at");

-- At most one running timer (ended_at IS NULL) per user.
CREATE UNIQUE INDEX "time_entries_one_running_per_user"
  ON "time_entries" ("user_id")
  WHERE "ended_at" IS NULL;

-- No two entries of the same user may overlap. Ranges are half-open [start, end), so
-- back-to-back entries (one ends exactly when the next starts) are allowed. A running
-- entry has an unbounded upper end, so nothing can be placed after its start.
ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_no_overlap_per_user"
  EXCLUDE USING gist (
    "user_id" WITH =,
    tstzrange("started_at", "ended_at", '[)') WITH &&
  );

-- ─── other tables ───────────────────────────────────────────────────────────────

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "users_failed_login_count_nonnegative" CHECK ("failed_login_count" >= 0);

ALTER TABLE "invites"
  ADD CONSTRAINT "invites_email_lowercase" CHECK ("email" = lower("email"));

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_color_hex" CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT "projects_budget_hours_positive" CHECK ("budget_hours" IS NULL OR "budget_hours" > 0);

ALTER TABLE "project_members"
  ADD CONSTRAINT "project_members_hourly_rate_nonnegative"
  CHECK ("hourly_rate" IS NULL OR "hourly_rate" >= 0);

ALTER TABLE "org_settings"
  ADD CONSTRAINT "org_settings_single_row" CHECK ("id" = 1),
  ADD CONSTRAINT "org_settings_week_start_day" CHECK ("week_start_day" BETWEEN 1 AND 7),
  ADD CONSTRAINT "org_settings_rounding_minutes" CHECK ("rounding_minutes" BETWEEN 0 AND 60),
  ADD CONSTRAINT "org_settings_max_timer_duration"
    CHECK ("max_timer_duration_seconds" BETWEEN 60 AND 86400),
  ADD CONSTRAINT "org_settings_lock_after_days" CHECK ("lock_after_days" IS NULL OR "lock_after_days" >= 1);

-- Audit log rows are immutable once written.
CREATE FUNCTION "audit_logs_prevent_change"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_prevent_change"();
