#!/bin/bash
# usage: pshot.sh prefix [ONLY]
cd /home/user/Livestreamingapp/.claude/worktrees/agent-a1583156c1fb66f8e && npm run planner:build >/dev/null 2>&1 || { echo BUILD FAILED; exit 1; }
cd /tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad && ONLY="$2" SCHEMES="${3:-light,dark}" node shots-pro.js http://localhost:8731/planner/ "$1" 2>&1 | tail -5
