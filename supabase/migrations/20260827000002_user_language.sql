-- Per-account UI language.
--
-- The club is Danish, so 'da' is the default for existing and new rows alike.
-- Server-generated text (emails, notifications) is Danish regardless — this
-- column drives the React UI only, and is mirrored into localStorage so the
-- login screen can paint in the right language before any fetch.

ALTER TABLE users
  ADD COLUMN language VARCHAR(2) NOT NULL DEFAULT 'da'
  CHECK (language IN ('da', 'en'));
