#!/bin/bash
# usage: runsql.sh dbname file...
db=$1; shift
psql -h 127.0.0.1 -U postgres -q -c "drop database if exists $db" -c "create database $db" >/dev/null
args=()
for f in "$@"; do args+=(-f "$f"); done
psql -h 127.0.0.1 -U postgres -q -d $db -o /dev/null -v ON_ERROR_STOP=0 "${args[@]}" 2>&1 | grep -v 'already exists' | grep -v 'skipping' | grep -v 'NOTICE:  ok:' 
