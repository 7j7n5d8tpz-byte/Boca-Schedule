-- Persist a summary of the optimizer's last run for a match, so the coach can
-- see *why* the squad looks the way it does (formation coverage, deficit, the
-- fairness/positions balance used). Populated by the single + batch optimizers;
-- NULL until a match has been optimized.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS optimization_result JSONB;
