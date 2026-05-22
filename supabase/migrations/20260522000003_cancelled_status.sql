ALTER TABLE matches DROP CONSTRAINT matches_status_check;
ALTER TABLE matches ADD CONSTRAINT matches_status_check CHECK (
  status IN ('draft','signup_open','signup_closed','optimized','published','completed','cancelled')
);
