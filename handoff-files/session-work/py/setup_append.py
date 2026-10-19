"""Append update-10 to setup.sql (replacing an earlier copy), like the other updates."""
MARK = '-- ---- Planner show day and production tools (the same as update-10-planner-pro.sql) ----'
s = open('supabase/setup.sql').read()
if MARK in s:
    s = s[: s.index(MARK)].rstrip('\n') + '\n'
u = open('supabase/update-10-planner-pro.sql').read()
body = u[u.index('do $$'):]
s = s.rstrip('\n') + '\n\n' + MARK + '\n-- See update-10-planner-pro.sql for what it does and who may do what.\n\n' + body
old = """-- and the sign-in settings and features the Lumora team controls from the
-- apps (at the end; the same as update-9-sign-in-settings.sql)."""
new = """-- and the sign-in settings and features the Lumora team controls from the
-- apps (at the end; the same as update-9-sign-in-settings.sql) and the
-- Planner's show day and production tools (at the end; the same as
-- update-10-planner-pro.sql)."""
if old in s:
    s = s.replace(old, new, 1)
open('supabase/setup.sql', 'w').write(s)
print('ok')
