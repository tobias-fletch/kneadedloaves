-- Optional HTML alternative stored beside the plain-text body.
-- Null for password resets, contact messages, and jobs queued before this column existed.
ALTER TABLE "EmailJob" ADD COLUMN IF NOT EXISTS "html" TEXT;
