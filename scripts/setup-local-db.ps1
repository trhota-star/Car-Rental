# Creates the local DriveEasy database user and databases on the DriveEasy
# PostgreSQL 18 server (Windows service 'postgresql-driveeasy', port 5434).
# The superuser password is read from %APPDATA%\postgresql\pgpass.conf.
# Usage: pnpm db:setup
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$port = 5434

$line = Get-Content "$root\.env.local" | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if ($line -notmatch '^DATABASE_URL=postgres://driveeasy:([^@]+)@') { throw 'DATABASE_URL in .env.local is missing or malformed' }
$appPassword = $Matches[1]

& $psql -h localhost -p $port -U postgres -d postgres -w -v ON_ERROR_STOP=1 -v "pw=$appPassword" -f "$PSScriptRoot\setup-local-db.sql"
if ($LASTEXITCODE -ne 0) { throw "psql failed with exit code $LASTEXITCODE" }
Write-Host "`nDone. Now run: pnpm db:check"
