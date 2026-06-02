#!/usr/bin/env bash
# CSV取得用トークン EXPORT_TOKEN を Worker に登録する（入力プロンプトが出る）。
# 使い方: リポジトリ直下で  bash set-secret.sh
set -euo pipefail
cd "$(dirname "$0")/value-compass/worker"
wrangler secret put EXPORT_TOKEN
