#!/bin/bash
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
# shellcheck source=/dev/null
. /etc/os-release
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" |
  sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null
sudo apt-get update -q
sudo apt-get install -y -q postgresql-client-17
/usr/lib/postgresql/17/bin/pg_dump --version
