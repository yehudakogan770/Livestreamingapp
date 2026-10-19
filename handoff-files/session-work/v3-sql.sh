#!/bin/bash
# usage: v3-sql.sh <worktree>  (pgstart.sh must be running)
R=$1/supabase
P="psql -h /dev/shm/lumora-pg-sec -p 55432 -U postgres -v ON_ERROR_STOP=1 -q -X"
$P -c "drop database if exists t8" 2>/dev/null
$P -c "drop role if exists anon" -c "drop role if exists authenticated" 2>/dev/null || true
$P -c "create database t8" || exit 1
echo "== chat test"
$P -d t8 -f $R/test/mock-auth.sql -f $R/setup.sql -f $R/update-3-reports.sql -f $R/update-8-planner.sql -f $R/test/planner-chat-test.sql 2>&1 | grep -E "ok:|FAILED|ERROR|WARNING"
$P -c "drop database if exists t8"
$P -c "drop role if exists anon" -c "drop role if exists authenticated" 2>/dev/null
$P -c "create database t8"
echo "== security test (setup + 3 + 6 + 7 + 8 twice)"
$P -d t8 -f $R/test/mock-auth.sql -f $R/setup.sql -f $R/update-3-reports.sql -f $R/update-6-security.sql -f $R/update-8-planner.sql -f $R/update-8-planner.sql -f $R/test/security-test.sql 2>&1 | grep -E "FAILED|ERROR|WARNING" ; echo "security exit done"
$P -d t8 -f $R/test/security-test.sql 2>&1 | grep -c "ok:"
