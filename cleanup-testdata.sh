#!/usr/bin/env bash
# 動作確認で投入したテスト2行だけをKVから削除する（本物の回答は消さない）。
# 使い方: リポジトリ直下で  bash cleanup-testdata.sh
set -euo pipefail
NS=c5bf6d8e591c4297a01ba3d113f9e4bd   # 本番 LOGS namespace
for key in \
  "session:connectivity-test" \
  "session:e01bd8a8-91cc-43b6-a9b7-ecf0a6654469"
do
  echo "削除: $key"
  wrangler kv key delete "$key" --namespace-id "$NS" --remote
done
echo "✓ テスト2行を削除しました"
