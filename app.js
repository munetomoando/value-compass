/*
 * app.js — 画面遷移・設問進行・応答時間計測・送信（設計書 §10, §8.2）
 * 推定はクライアント側（estimate.js）で完結。バックエンドが落ちていても結果表示は成立する。
 */
(function () {
  "use strict";

  // ===== 設定 =====
  // Worker のエンドポイント。空文字なら送信せずローカル完結（フロント完結版）。
  const SUBMIT_ENDPOINT = ""; // 例: "https://value-compass.<account>.workers.dev/api/submit"
  const APP_VERSION = "0.1";

  // ===== 状態 =====
  let DATA = null;        // questions.json
  let META = null;
  let SEQUENCE = [];      // 提示する設問の配列（練習→本番→…）
  let cursor = 0;
  let answers = [];       // { q_id, choice, response_ms }
  let questionShownAt = 0;
  let sessionId = "";
  let estResult = null;

  // ===== ユーティリティ =====
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function $(sel) { return document.querySelector(sel); }
  function show(id) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
    $("#" + id).classList.add("active");
    window.scrollTo(0, 0);
  }

  function attrLine(attrId, level) {
    const def = META.attributes[attrId];
    return { label: def.label, value: def.levels[level] };
  }

  // ===== 初期化 =====
  function init() {
    fetch("questions.json")
      .then(function (r) { return r.json(); })
      .then(function (json) {
        DATA = json;
        META = json.meta;
        SEQUENCE = json.questions.slice(); // 練習1 + 本番10 + 支配1（固定順）
        bindIntro();
      })
      .catch(function (e) {
        $("#intro").innerHTML = '<p class="error">設問データの読み込みに失敗しました。ローカルでは簡易サーバ経由で開いてください（例: <code>python3 -m http.server</code>）。</p>';
        console.error(e);
      });
  }

  function bindIntro() {
    $("#start-btn").addEventListener("click", function () {
      sessionId = uuid();
      cursor = 0;
      answers = [];
      renderQuestion();
      show("question");
    });
  }

  function bindTransition() {
    $("#begin-main-btn").addEventListener("click", function () {
      renderQuestion();
      show("question");
    });
  }

  // ===== 設問描画 =====
  function renderQuestion() {
    const q = SEQUENCE[cursor];
    const order = META.attribute_order;

    // 進捗（練習・支配は番号表示を工夫）
    const totalForBar = SEQUENCE.length;
    $("#progress-bar-fill").style.width = ((cursor) / totalForBar * 100) + "%";

    let badge = "";
    if (q.type === "practice") badge = '<span class="badge practice">練習（集計対象外）</span>';
    else if (q.type === "dominant") badge = ""; // 注意チェックは本番に紛れ込ませる（ラベルを出さない）
    else {
      // 本番の通し番号
      const mainNo = SEQUENCE.slice(0, cursor + 1).filter(function (x) { return x.type === "main"; }).length;
      const mainTotal = SEQUENCE.filter(function (x) { return x.type === "main"; }).length;
      badge = '<span class="badge">設問 ' + mainNo + " / " + mainTotal + "</span>";
    }
    $("#q-badge").innerHTML = badge;
    $("#q-title").textContent = q.type === "practice"
      ? "まずは練習です。どちらの求人で働きたいですか？"
      : "どちらの求人で働きたいですか？";

    function card(side) {
      const job = q[side];
      const rows = order.map(function (attrId) {
        const a = attrLine(attrId, job[attrId]);
        return '<li><span class="k">' + a.label + '</span><span class="v">' + a.value + "</span></li>";
      }).join("");
      return '<button class="job-card" data-choice="' + side + '">' +
        '<h3>求人 ' + side + "</h3><ul>" + rows + "</ul>" +
        '<span class="choose">これで働く</span></button>';
    }

    $("#choices").innerHTML = card("A") + card("B");
    $("#choices").querySelectorAll(".job-card").forEach(function (btn) {
      btn.addEventListener("click", function () { onChoose(btn.getAttribute("data-choice"), btn); });
    });

    // ページめくりアニメーションを毎回再生（同じ構図でも「進んだ」と分かるように）
    const content = $("#q-content");
    content.classList.remove("page-turn", "page-out");
    void content.offsetWidth; // reflow して再トリガ
    content.classList.add("page-turn");

    questionShownAt = performance.now();
  }

  function onChoose(choice, btn) {
    const q = SEQUENCE[cursor];
    const ms = Math.round(performance.now() - questionShownAt);
    answers.push({ q_id: q.id, choice: choice, response_ms: ms });

    // 選択を即座に視覚フィードバック：選んだカードを強調し、両カードを操作不可に
    const cards = $("#choices").querySelectorAll(".job-card");
    cards.forEach(function (c) {
      c.style.pointerEvents = "none";
      if (c !== btn) c.classList.add("dimmed");
    });
    if (btn) btn.classList.add("chosen");

    cursor += 1;
    const advance = function () {
      if (cursor >= SEQUENCE.length) { computeAndShowResult(); return; }
      // 練習を選んだ直後は、本番開始の案内画面を挟む（練習の位置づけを明確化）
      if (q.type === "practice") { show("transition"); return; }
      renderQuestion();
    };

    // 反応を見せてから、ページをめくって次へ
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { advance(); return; }

    const stage = $("#q-stage");
    setTimeout(function () {
      const content = $("#q-content");
      content.classList.remove("page-turn");
      content.classList.add("page-out"); // めくれて消える
      setTimeout(advance, 240);
      void stage; // 参照保持（将来の拡張用）
    }, 160);
  }

  // ===== 推定・結果 =====
  function computeAndShowResult() {
    $("#progress-bar-fill").style.width = "100%";
    const E = window.ValueCompassEstimate;
    const est = E.estimate(DATA.questions, META, answers);
    const quality = E.qualityCheck(DATA.questions, answers);
    const verbal = E.verbalize(DATA.questions, META, est);
    estResult = { est: est, quality: quality, verbal: verbal };

    $("#result-text").innerHTML = mdBold(verbal.text);

    $("#keep-list").innerHTML = verbal.keep.map(function (s) {
      return "<li>" + s + "</li>";
    }).join("");
    $("#tradeable-list").innerHTML = verbal.tradeable.map(function (s) {
      return "<li>" + s + "</li>";
    }).join("");

    // 重視度バー
    const labelOf = {
      income: "年収", location: "勤務地・転勤", hours: "労働時間", remote: "在宅勤務", growth: "裁量・成長", stability: "雇用安定性"
    };
    $("#score-bars").innerHTML = est.ranking.map(function (attr) {
      const imp = Math.round(est.importance[attr] * 100);
      return '<div class="score-row"><span class="score-label">' + labelOf[attr] + "</span>" +
        '<span class="score-track"><span class="score-fill" style="width:' + imp + '%"></span></span>' +
        '<span class="score-num">' + imp + "</span></div>";
    }).join("");

    if (!quality.dominant_passed) {
      $("#quality-note").style.display = "block";
    }

    show("result");
  }

  function mdBold(s) {
    return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  // ===== DCE 種明かし =====
  function bindReveal() {
    $("#reveal-btn").addEventListener("click", function () {
      $("#reveal-box").style.display = "block";
      $("#reveal-btn").style.display = "none";
    });
    $("#to-confirm-btn").addEventListener("click", function () { show("confirm"); });
  }

  // ===== 確認画面・送信 =====
  function bindConfirm() {
    $("#confirm-form").addEventListener("submit", function (e) {
      e.preventDefault();
      const agreementEl = document.querySelector('input[name="agreement"]:checked');
      const agreement = agreementEl ? parseInt(agreementEl.value, 10) : null;
      const freeText = $("#free-text").value.trim();

      const payload = buildPayload(agreement, freeText);
      submit(payload);
    });
  }

  function buildPayload(agreement, freeText) {
    return {
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      answers: answers,
      scores: estResult.est.scores,
      quality: {
        dominant_passed: estResult.quality.dominant_passed,
        min_response_ms: estResult.quality.min_response_ms,
        consistency_flags: 0
      },
      feedback: { agreement: agreement, free_text: freeText },
      app_version: APP_VERSION
    };
  }

  function submit(payload) {
    show("complete");
    if (!SUBMIT_ENDPOINT) {
      // フロント完結版：送信先未設定。ローカルにのみ保持し、ログを表示できるようにする。
      $("#complete-note").textContent = "（ローカル完結モード：回答はサーバへ送信していません）";
      window.__lastPayload = payload;
      console.log("ValueCompass payload:", payload);
      return;
    }
    fetch(SUBMIT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      $("#complete-note").textContent = r.ok ? "回答を受け付けました。" : "送信に失敗しましたが、結果は表示されています。";
    }).catch(function () {
      $("#complete-note").textContent = "送信に失敗しましたが、結果は表示されています。";
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    init();
    bindTransition();
    bindReveal();
    bindConfirm();
  });
})();
