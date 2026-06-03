#!/usr/bin/env bash
# 回答ログCSVを取得して value-compass-logs.csv に保存する。
# 使い方: リポジトリ直下で  bash export-csv.sh <EXPORT_TOKEN>
set -euo pipefail
TOKEN="${1:?使い方: bash export-csv.sh <EXPORT_TOKEN>}"
URL="https://value-compass.ando-munetomo.workers.dev/api/export?key=${TOKEN}"
curl -fsS "$URL" -o value-compass-logs.csv
echo "✓ value-compass-logs.csv を保存しました（$(wc -l < value-compass-logs.csv | tr -d ' ') 行）"
