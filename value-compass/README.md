# 価値観コンパス / ValueCompass — v0.2「めくって発見」

DCE（離散選択実験）型の自己理解アプリ。求人の二択を繰り返し選ばせ、各労働条件への選好を
選択ログから逆算する。v0.2では、進行中は事実のトレードオフのみ提示し、最後に「めくって発見」で
重視度レーダー・お金換算（限界代替率）・決定的だった瞬間を1枚ずつ開いて返す。

設計書: `../design_dce_career_app.md`（MVP）／`../20260602価値観コンパス_発見体験設計.md`（v0.2）
著者: 安藤至大 (Munetomo Ando)

## 構成

```
value-compass/
├── frontend/               # GitHub Pages 配信対象（フロント完結で全画面が動く）
│   ├── index.html          # 画面遷移（導入→練習→案内→本番16→結果リビール→確認→完了）
│   ├── app.js              # 設問進行・順序ランダム化・進行中トレードオフ・結果リビール制御・送信
│   ├── questions.json      # 16問のDCEデザイン＋メタ（生成物）
│   ├── build-questions.mjs # 設問の決定論的生成＋バランス検証スクリプト
│   ├── estimate.js         # ロジット推定(IRLS+リッジ)・MRS・決定的瞬間・カウント整合・言語化
│   ├── radar.js            # レーダーチャート（SVG）描画
│   ├── style.css
│   └── test/               # node:test による単体テスト
└── worker/                 # Cloudflare Workers（回答ログAPI）
    ├── src/index.js        # POST /api/submit（KV保存）・GET /api/export（CSV, トークン保護）
    └── wrangler.toml
```

## 完成している範囲（v0.2）

- **フロント完結**：バックエンド無しで 導入→練習1→案内→本番16（注意チェック1問を中盤に紛れ込ませ）→
  結果リビール5枚→確認→完了 まで動作。推定はクライアント側で完結する。
- **推定**：2択を差分の二項ロジット（条件付きロジット）で罰則付き最尤推定（IRLS＋リッジ）。
  少観測・完全分離でも有限に安定。年収を基準財に MRS（お金換算, 万円）を算出（β_income≦0 の場合は
  「換算を省略」と表示）。重視度はスケール非依存指標 `|β|×sd(差分)` をレーダーで可視化。
- **設問**：`income` は4水準（300/450/600/750万・30歳頃の額面）、提示順はセッション毎ランダム化。
  `build-questions.mjs` が分岐回数・水準分布・支配ペア不在を満たすまで決定論生成し検証する。
- **匿名方針**：個人識別情報は取得しない（設計書 §9.2 踏襲）。

## ローカルでの動作確認

`file://` 直開きは `fetch(questions.json)` がブロックされるため、簡易サーバ経由で開く:

```bash
cd frontend
python3 -m http.server 8000
# ブラウザで http://localhost:8000/ を開く
```

## テスト

zero-dependency。Node.js（v18+）の組み込みテストランナーを使用:

```bash
cd frontend
node --test test/questions.test.mjs test/logit.test.mjs test/estimate.test.mjs test/radar.test.mjs
```

設問を作り直す場合（シード固定で決定論的に再生成）:

```bash
cd frontend
node build-questions.mjs   # questions.json を再生成
```

## バックエンド送信を有効にする

`frontend/app.js` 冒頭の `SUBMIT_ENDPOINT` が空文字なら「ローカル完結モード」で、回答はサーバへ
送信されずコンソールに payload を出力する。Cloudflare Worker（`/api/submit`）をデプロイ後、その URL を
`SUBMIT_ENDPOINT` に設定すると回答ログが送信される。デプロイ手順は `worker/wrangler.toml` のコメント参照
（KV作成 → `ALLOWED_ORIGIN` 設定 → `wrangler secret put EXPORT_TOKEN` → `wrangler deploy`）。
`/api/export?key=...` は CSV を出力（β・MRS・決定的瞬間の列を含む。自由記述は式インジェクション対策済み）。
