-- Add partial unique index for email (active customers only)
-- This allows deleted customers' emails to be reused

DROP INDEX IF EXISTS "customers_email_key";

CREATE UNIQUE INDEX "customers_email_key" 
  ON "customers"("email") 
  WHERE "is_active" = true AND "deleted_at" IS NULL;
