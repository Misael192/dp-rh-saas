#!/usr/bin/env bash
# Start local PostgreSQL and Redis for PeopleFlow development/tests in this cloud snapshot.
set -e
service postgresql status >/dev/null 2>&1 || service postgresql start
service redis-server status >/dev/null 2>&1 || service redis-server start
sleep 1
pg_isready -q && echo "postgres ready"
redis-cli ping
