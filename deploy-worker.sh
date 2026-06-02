#!/usr/bin/env bash
# Cloudflare Worker（回答ログAPI）をデプロイする。
# 使い方: リポジトリ直下で  bash deploy-worker.sh
set -euo pipefail
cd "$(dirname "$0")/value-compass/worker"
wrangler deploy
