-- Repair matches whose sign-up deadline was set after kick-off.
--
-- Nothing used to stop a coach putting the deadline past the match — a blanket
-- "end of month" date across a block of fixtures did it. Two things then broke:
-- players could sign up for a match that had already been played, and the match
-- never left `signup_open`, so it never auto-completed and its result could
-- never be entered. The API now rejects such a window on create and on edit;
-- these are the rows created before it did.
--
-- The repair keeps the evident intent — sign-ups open as long as possible — by
-- moving the deadline to kick-off, the latest the app allows. match_date and
-- match_time are naive club wall-clock, so they are resolved in
-- Europe/Copenhagen exactly as the backend does.
UPDATE matches
SET
    -- valid_signup_window requires close > open. A row whose open date also sat
    -- past kick-off is pulled back with it rather than left violating the
    -- constraint.
    signup_open_date = LEAST(
        signup_open_date,
        ((match_date + match_time) AT TIME ZONE 'Europe/Copenhagen') - INTERVAL '1 day'
    ),
    signup_close_date = (match_date + match_time) AT TIME ZONE 'Europe/Copenhagen',
    updated_at = NOW()
WHERE signup_close_date > ((match_date + match_time) AT TIME ZONE 'Europe/Copenhagen');
