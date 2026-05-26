ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_category TEXT NOT NULL DEFAULT 'serie' CHECK (match_category IN ('serie', 'pokal'));
ALTER TABLE matches ADD COLUMN IF NOT EXISTS serie_letter TEXT;
