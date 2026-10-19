#!/bin/bash
P=/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/pg
/usr/lib/postgresql/16/bin/initdb -D $P/data -A trust > /dev/null
/usr/lib/postgresql/16/bin/pg_ctl -D $P/data -o "-p 5499 -k $P" -l $P/log start
