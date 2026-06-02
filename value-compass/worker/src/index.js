/*
 * Cloudflare Workers — 価値観コンパス 回答ログ受信API（設計書 §8.2）
 *
 * エンドポイント:
 *   POST /api/submit          回答ログ(JSON)を受信し KV へ保存（キー: session:<uuid>）
 *   GET  /api/export?key=...  管理用にログを CSV 出力（簡易トークン保護）
 *
 * バインディング（wrangler.toml で設定）:
 *   LOGS            KV namespace（回答ログ保存先）
 *   ALLOWED_ORIGIN  var: CORS で許可する GitHub Pages のオリジン
 *   EXPORT_TOKEN    secret: /api/export のトークン（`wrangler secret put EXPORT_TOKEN`）
 */

const ATTR_ORDER = ["income", "location", "hours", "remote", "growth", "stability"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    // CORS プリフライト
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
    }

    if (url.pathname === "/api/submit" && request.method === "POST") {
      return handleSubmit(request, env, origin);
    }
    if (url.pathname === "/api/export" && request.method === "GET") {
      return handleExport(url, env);
    }

    return new Response("Not Found", { status: 404 });
  }
};

// ===== CORS =====
function corsHeaders(env, origin) {
  const allowed = env.ALLOWED_ORIGIN || "";
  // 設定オリジンと一致する場合のみ許可（GitHub Pages のオリジンのみ）
  const allowOrigin = origin && origin === allowed ? origin : allowed;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, extraHeaders || {})
  });
}

// ===== POST /api/submit =====
async function handleSubmit(request, env, origin) {
  const cors = corsHeaders(env, origin);

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ ok: false, error: "invalid_json" }, 400, cors);
  }

  // 最小限のバリデーション（匿名・個人情報は受け取らない方針: §9.2）
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.answers)) {
    return json({ ok: false, error: "invalid_payload" }, 400, cors);
  }

  // session_id はサーバ側でも検証しつつ、無ければ生成
  const sessionId = typeof payload.session_id === "string" && payload.session_id
    ? payload.session_id
    : crypto.randomUUID();

  // 保存用に正規化（受信値はそのまま保持、サーバ受信時刻を付与）
  const record = {
    session_id: sessionId,
    timestamp: payload.timestamp || new Date().toISOString(),
    received_at: new Date().toISOString(),
    answers: payload.answers,
    scores: payload.scores || null,
    quality: payload.quality || null,
    feedback: payload.feedback || null,
    app_version: payload.app_version || null,
    estimate: payload.estimate || null,
    counts: payload.counts || null,
    decisive: payload.decisive || null,
    framing: payload.framing || null,
    question_order: payload.question_order || null
  };

  await env.LOGS.put("session:" + sessionId, JSON.stringify(record));

  return json({ ok: true, session_id: sessionId }, 200, cors);
}

// ===== GET /api/export?key=... =====
async function handleExport(url, env) {
  const key = url.searchParams.get("key") || "";
  if (!env.EXPORT_TOKEN || key !== env.EXPORT_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  // KV から session:* を列挙して取得（授業規模=数十〜数百件を想定）
  const records = [];
  let cursor = undefined;
  do {
    const list = await env.LOGS.list({ prefix: "session:", cursor });
    for (const k of list.keys) {
      const v = await env.LOGS.get(k.name);
      if (v) {
        try { records.push(JSON.parse(v)); } catch (e) { /* skip broken */ }
      }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  const csv = toCsv(records);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="value-compass-logs.csv"'
    }
  });
}

function csvEscape(val) {
  if (val === null || val === undefined) return "";
  let s = String(val);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // 表計算ソフトの数式インジェクション対策
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(records) {
  const header = [
    "session_id", "timestamp", "received_at", "app_version",
    ...ATTR_ORDER.map((a) => "count_" + a),
    ...ATTR_ORDER.map((a) => "beta_" + a),
    ...ATTR_ORDER.filter(a => a !== "income").map((a) => "mrs_" + a),
    "most_hesitated_qid", "fastest_qid", "logit_count_divergence",
    "dominant_passed", "min_response_ms",
    "agreement", "free_text", "answers_json"
  ];

  const rows = records.map((r) => {
    const scores = r.scores || r.counts || {};
    const quality = r.quality || {};
    const feedback = r.feedback || {};
    return [
      r.session_id, r.timestamp, r.received_at, r.app_version,
      ...ATTR_ORDER.map((a) => (a in scores ? scores[a] : "")),
      ...ATTR_ORDER.map(a => (r.estimate && r.estimate.beta && a in r.estimate.beta) ? r.estimate.beta[a] : ""),
      ...ATTR_ORDER.filter(a => a !== "income").map(a => (r.estimate && r.estimate.mrs_manyen && a in r.estimate.mrs_manyen) ? r.estimate.mrs_manyen[a] : ""),
      (r.decisive && r.decisive.most_hesitated_qid) || "",
      (r.decisive && r.decisive.fastest_qid) || "",
      (quality.logit_count_divergence != null) ? quality.logit_count_divergence : "",
      quality.dominant_passed, quality.min_response_ms,
      feedback.agreement, feedback.free_text,
      JSON.stringify(r.answers || [])
    ].map(csvEscape).join(",");
  });

  return [header.map(csvEscape).join(","), ...rows].join("\n") + "\n";
}
