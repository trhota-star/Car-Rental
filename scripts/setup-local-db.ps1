# Creates the local DriveEasy database user and databases on PostgreSQL 18.
# Asks for the 'postgres' superuser password; it is not stored anywhere.
# Usage: pnpm db:setup
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$port = 5433

$line = Get-Content "$root\.env.local" | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if ($line -notmatch '^DATABASE_URL=postgres://driveeasy:([^@]+)@') { throw 'DATABASE_URL in .env.local is missing or malformed' }
$appPassword = $Matches[1]

$secure = Read-Host "Password for PostgreSQL 18 superuser 'postgres'" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
try {
  & $psql -h localhost -p $port -U postgres -d postgres -v ON_ERROR_STOP=1 -v "pw=$appPassword" -f "$PSScriptRoot\setup-local-db.sql"
  if ($LASTEXITCODE -ne 0) { throw "psql failed with exit code $LASTEXITCODE" }
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
Write-Host "`nDone. Now run: pnpm db:check"
