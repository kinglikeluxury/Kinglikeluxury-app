#!/bin/bash
# Safe Read-Only Production Database Backup Script
# NO writes, NO migrations, NO modifications — export only

set -e

TIMESTAMP=$(date -u +"%Y-%m-%d-%H-%M")
BACKUP_DIR="/home/runner/workspace/backups"
FILENAME="backup-production-${TIMESTAMP}.sql"
FILEPATH="${BACKUP_DIR}/${FILENAME}"
ZIP_FILE="${BACKUP_DIR}/backup-production-${TIMESTAMP}.zip"

mkdir -p "$BACKUP_DIR"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set."
  exit 1
fi

echo "Starting read-only backup..."
echo "Target: ${FILEPATH}"
echo "Database: $(echo $DATABASE_URL | sed 's/:\/\/[^@]*@/:\\/\\/<credentials>@/')"

pg_dump \
  "$DATABASE_URL" \
  --format=plain \
  --no-owner \
  --no-acl \
  --verbose \
  --file="$FILEPATH" 2>&1

echo ""
echo "SQL backup complete: ${FILEPATH}"
echo "Size: $(du -sh "$FILEPATH" | cut -f1)"

zip -j "$ZIP_FILE" "$FILEPATH"
echo "ZIP created: ${ZIP_FILE}"
echo "ZIP size: $(du -sh "$ZIP_FILE" | cut -f1)"
echo ""
echo "Done. No data was modified."
