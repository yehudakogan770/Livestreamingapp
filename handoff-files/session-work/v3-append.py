import re, sys
root = sys.argv[1]
setup = open(root + '/supabase/setup.sql').read()
u8 = open(root + '/supabase/update-8-planner.sql').read()
body = u8[u8.index('do $$'):]
marker = '-- ---- Planner chat and schedules (the same as update-8-planner.sql) ----'
check = '-- ---- Check: every table has row level security ----'
if marker in setup:
    start = setup.index(marker)
    end = setup.index(check)
    setup = setup[:start] + setup[end:]
i = setup.index(check)
block = marker + '\n-- See update-8-planner.sql for what it does.\n\n' + body.rstrip() + '\n\n'
setup = setup[:i] + block + setup[i:]
open(root + '/supabase/setup.sql', 'w').write(setup)
