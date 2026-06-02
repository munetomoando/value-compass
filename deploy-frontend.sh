#!/usr/bin/env bash
# frontend/ サブフォルダの中身を gh-pages ブランチのルートとして公開する。
# 使い方: リポジトリ直下で  bash deploy-frontend.sh
set -euo pipefail
cd "$(dirname "$0")"                       # リポジトリ直下(compass)へ
SPLIT=$(git subtree split --prefix=value-compass/frontend main)
git push origin "${SPLIT}:refs/heads/gh-pages" --force
echo "✓ deployed split ${SPLIT} -> gh-pages"
