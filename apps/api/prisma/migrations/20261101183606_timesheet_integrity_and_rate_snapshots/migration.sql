-- CreateEnum
CREATE TYPE "timesheet_review_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN     "hourly_rate" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "timesheets" ADD COLUMN     "period_end" TIMESTAMPTZ(3),
ADD COLUMN     "period_start" TIMESTAMPTZ(3),
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "total_seconds" INTEGER;

-- CreateTable
CREATE TABLE "timesheet_reviews" (
    "id" UUID NOT NULL,
    "timesheet_id" UUID NOT NULL,
    "project_id" UUID,
    "status" "timesheet_review_status" NOT NULL DEFAULT 'PENDING',
    "seconds" INTEGER NOT NULL,
    "reviewer_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timesheet_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "timesheet_reviews_project_id_status_idx" ON "timesheet_reviews"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_reviews_timesheet_id_project_id_key" ON "timesheet_reviews"("timesheet_id", "project_id");

-- CreateIndex
CREATE INDEX "timesheets_user_id_period_start_idx" ON "timesheets"("user_id", "period_start");

-- AddForeignKey
ALTER TABLE "timesheet_reviews" ADD CONSTRAINT "timesheet_reviews_timesheet_id_fkey" FOREIGN KEY ("timesheet_id") REFERENCES "timesheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_reviews" ADD CONSTRAINT "timesheet_reviews_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_reviews" ADD CONSTRAINT "timesheet_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── timesheets: fixed periods ───────────────────────────────────────────────────
-- Existing weeks get the period their owner's current timezone gives them (the best we know).
UPDATE "timesheets" t
SET "timezone" = u."timezone",
    "period_start" = (t."week_start"::timestamp) AT TIME ZONE u."timezone",
    "period_end" = ((t."week_start" + 7)::timestamp) AT TIME ZONE u."timezone"
FROM "users" u
WHERE u."id" = t."user_id" AND t."status" <> 'DRAFT';

-- A submitted, approved or returned week always knows its fixed period.
ALTER TABLE "timesheets"
  ADD CONSTRAINT "timesheets_period_fixed" CHECK (
    "status" = 'DRAFT'
    OR ("timezone" IS NOT NULL AND "period_start" IS NOT NULL AND "period_end" > "period_start")
  );

-- Locked weeks (submitted or approved) of one person never overlap, even if the organization's
-- week start day changes between submissions.
ALTER TABLE "timesheets"
  ADD CONSTRAINT "timesheets_locked_periods_no_overlap"
  EXCLUDE USING gist (
    "user_id" WITH =,
    tstzrange("period_start", "period_end", '[)') WITH &&
  ) WHERE ("status" IN ('SUBMITTED', 'APPROVED'));

-- ─── timesheet reviews ───────────────────────────────────────────────────────────
-- At most one "whole week" review (a week without tracked time) per timesheet.
CREATE UNIQUE INDEX "timesheet_reviews_one_whole_week"
  ON "timesheet_reviews" ("timesheet_id") WHERE "project_id" IS NULL;

-- Existing reviewed or pending weeks become one whole-week review with the same outcome.
INSERT INTO "timesheet_reviews"
  ("id", "timesheet_id", "project_id", "status", "seconds", "reviewer_id", "reviewed_at", "comment")
SELECT gen_random_uuid(), t."id", NULL,
       (CASE t."status" WHEN 'SUBMITTED' THEN 'PENDING' ELSE t."status"::text END)::"timesheet_review_status",
       0, t."reviewer_id", t."reviewed_at", t."comment"
FROM "timesheets" t
WHERE t."status" <> 'DRAFT';

-- ─── time entries: rate snapshots ────────────────────────────────────────────────
-- Each entry keeps the member's rate from when it was saved (or moved to another project),
-- whatever code path writes it, so changing a rate only affects time tracked from then on.
CREATE FUNCTION "time_entries_snapshot_rate"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW."hourly_rate" := (
    SELECT m."hourly_rate" FROM "project_members" m
    WHERE m."project_id" = NEW."project_id" AND m."user_id" = NEW."user_id"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "time_entries_rate_on_insert"
  BEFORE INSERT ON "time_entries"
  FOR EACH ROW EXECUTE FUNCTION "time_entries_snapshot_rate"();

CREATE TRIGGER "time_entries_rate_on_move"
  BEFORE UPDATE OF "project_id", "user_id" ON "time_entries"
  FOR EACH ROW
  WHEN (OLD."project_id" IS DISTINCT FROM NEW."project_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id")
  EXECUTE FUNCTION "time_entries_snapshot_rate"();

-- Existing entries: today's rates are the best record there is.
UPDATE "time_entries" e
SET "hourly_rate" = m."hourly_rate"
FROM "project_members" m
WHERE m."project_id" = e."project_id" AND m."user_id" = e."user_id";
