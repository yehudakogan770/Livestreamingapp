set -e
S=/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad
R=/home/user/Livestreamingapp/.claude/worktrees/agent-ae2e4fb2496ef2830/supabase
P="psql -h /dev/shm/lumora-pg-sec -p 55432 -U postgres -v ON_ERROR_STOP=1 -q -X"
$P -c "drop database if exists t1" 2>/dev/null
$P -c "drop role if exists anon" -c "drop role if exists authenticated" 2>/dev/null || true
$P -c "create database t1"
$P -d t1 -f $S/mock.sql
for f in "$@"; do
  echo "== $f"
  $P -d t1 -f $f
done
