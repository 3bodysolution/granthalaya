-- "Only me" is gone from the site. Existing entries marked that way become normal entries.
-- (The column stays: the admin's "Hide the entry" still uses it.)
update public.logs set only_me = false where only_me = true;
