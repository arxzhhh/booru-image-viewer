#!/bin/bash
# Package the Booru Image Viewer source code for deployment.
# Excludes node_modules, .next, and other build artifacts.

set -e

PROJECT_DIR="/home/z/my-project"
OUTPUT="/home/z/my-project/download/booru-image-viewer.zip"

# Clean up any previous zip
rm -f "$OUTPUT"

# Create a staging directory
STAGING="/tmp/booru-image-viewer"
rm -rf "$STAGING"
mkdir -p "$STAGING"

# Copy the project files (exclude heavy/build dirs)
cd "$PROJECT_DIR"

# Use rsync to copy everything except excluded patterns
rsync -a \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.git' \
  --exclude='dev.log' \
  --exclude='server.log' \
  --exclude='.zscripts' \
  --exclude='download' \
  --exclude='upload' \
  --exclude='worklog.md' \
  --exclude='skills' \
  --exclude='mini-services' \
  --exclude='examples' \
  --exclude='db/*.db' \
  --exclude='db/*.db-journal' \
  --exclude='prisma/*.db' \
  --exclude='prisma/*.db-journal' \
  ./ "$STAGING/"

# Remove the zip from staging if it got copied
rm -f "$STAGING/booru-image-viewer.zip"

# Create the zip
cd /tmp
zip -r "$OUTPUT" booru-image-viewer/ \
  -x "*/node_modules/*" \
  -x "*/.next/*" \
  -x "*/.git/*"

# Clean up staging
rm -rf "$STAGING"

# Report
SIZE=$(du -h "$OUTPUT" | cut -f1)
FILES=$(unzip -l "$OUTPUT" | tail -1 | awk '{print $2}')
echo "Created: $OUTPUT"
echo "Size: $SIZE"
echo "Files: $FILES"
