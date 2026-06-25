-- Repair fines that were created pointing at a merged tombstone instead of the
-- real account. This happens when the fines import runs after a placeholder has
-- already been merged: the import finds the tombstone by name and assigns
-- player_id to it rather than to the merged_into target.
--
-- Re-point every such fine to the real account in a single statement.

UPDATE public.fines f
SET    player_id  = u.merged_into,
       updated_at = NOW()
FROM   public.users u
WHERE  f.player_id   = u.user_id
  AND  u.merged_into IS NOT NULL;
