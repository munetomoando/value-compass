#!/usr/bin/env bash
# gh-pages ブランチのルートを GitHub Pages として公開する。
# 使い方: リポジトリ直下で  bash enable-pages.sh
set -euo pipefail
REPO=munetomoando/value-compass
if gh api "repos/${REPO}/pages" >/dev/null 2>&1; then
  echo "Pages は既に有効です。設定を gh-pages / root に更新します。"
  gh api -X PUT "repos/${REPO}/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null
else
  echo "Pages を新規有効化します（gh-pages / root）。"
  gh api -X POST "repos/${REPO}/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null
fi
echo "--- 現在の Pages 設定 ---"
gh api "repos/${REPO}/pages" --jq '"url:    " + .html_url, "status: " + (.status // "building")'
