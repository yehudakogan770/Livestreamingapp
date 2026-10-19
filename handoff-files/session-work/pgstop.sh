runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D /dev/shm/lumora-pg-sec/data stop -m fast
rm -rf /dev/shm/lumora-pg-sec
