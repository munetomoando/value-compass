/*
 * app.js — 画面遷移・設問進行・応答時間計測・送信（設計書 §10, §8.2）
 * 推定はクライアント側（estimate.js）で完結。バックエンドが落ちていても結果表示は成立する。
 */
(function () {
  "use strict";

  // ===== 設定 =====
  // Worker のエンドポイント。空文字なら送信せずローカル完結（フロント完結版）。
  const SUBMIT_ENDPOINT = ""; // 例: "https://value-compass.<account>.workers.dev/api/submit"

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
        SEQUENCE = buildSequence(json.questions);
        bindIntro();
      })
      .catch(function (e) {
        $("#intro").innerHTML = '<p class="error">設問データの読み込みに失敗しました。ローカルでは簡易サーバ経由で開いてください（例: <code>python3 -m http.server</code>）。</p>';
        console.error(e);
      });
  }

  function shuffle(arr){ // セッション毎ランダム（測定の順序効果対策）
    const a=arr.slice();
    for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  }
  function buildSequence(questions){
    const practice = questions.find(q=>q.type==="practice");
    const dominant = questions.find(q=>q.type==="dominant");
    const mains = shuffle(questions.filter(q=>q.type==="main"));
    const pos = 6 + Math.floor(Math.random()*5); // 6〜10番目あたりに支配選択を挿入
    mains.splice(pos, 0, dominant);
    return [practice, ...mains];
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

    if (q.type === "main") showTradeoffFlash(q, choice);

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

    setTimeout(function () {
      const content = $("#q-content");
      content.classList.remove("page-turn");
      content.classList.add("page-out"); // めくれて消える
      setTimeout(advance, 240);
    }, 160);
  }

  function showTradeoffFlash(q, choice){
    const order = META.attribute_order;
    const chosen = q[choice], other = (choice==="A"?q.B:q.A);
    let gained=null, gave=null;
    for(const a of order){
      if(chosen[a]===other[a]) continue;
      const def=META.attributes[a];
      const better = a==="income" ? (+chosen[a]>=+other[a]) : (chosen[a]===(def.good||def.good_nominal));
      if(better && !gained) gained={attr:a};
      if(!better && !gave) gave={attr:a};
    }
    const el = document.getElementById("tradeoff-flash");
    if(!el || (!gained && !gave)) return;
    const name=a=>({income:"年収",location:"転勤の少なさ",hours:"残業の少なさ",remote:"在宅勤務",growth:"裁量・成長",stability:"雇用の安定"})[a];
    el.textContent = (gained?`いま、あなたは〔${name(gained.attr)}〕を`:"いま、あなたは")+(gave?`〔${name(gave.attr)}〕と引き換えに選びました`:"選びました");
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  }

  // ===== 推定・結果 =====
  function computeAndShowResult() {
    $("#progress-bar-fill").style.width = "100%";
    const E = window.ValueCompassEstimate;
    const est = E.estimate(DATA.questions, META, answers);
    const ex = E.extras(DATA.questions, META, answers, est);
    estResult = { est: est, extras: ex };
    buildReveal(est, ex);
    if (!ex.quality.dominant_passed) $("#quality-note").style.display = "block";
    show("result");
  }

  function mdBold(s){ return s.replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>"); }

  function buildReveal(est, ex){
    const order = META.attribute_order;
    const label = ex.verbal.label;
    const radarItems = order.map(a=>({ label: ({income:"年収",location:"勤務地",hours:"労働時間",remote:"在宅勤務",growth:"裁量・成長",stability:"安定性"})[a], value: est.importance[a] }));
    const radarSVG = window.ValueCompassRadar.buildRadarSVG(radarItems);

    const moneyRows = est.importance_rank.filter(a=>a!=="income").slice(0,4).map(a=>{
      const v = est.mrs_manyen[a];
      const valHtml = (v===null) ? `<span class="val neg">換算を省略</span>`
        : (v>=0 ? `<span class="val">+${v}万円</span>` : `<span class="val neg">${v}万円</span>`);
      return `<div class="money-item"><span class="label">${label[a]}</span>${valHtml}</div>`;
    }).join("");
    const incNote = (Object.values(est.mrs_manyen).every(v=>v===null))
      ? `<p class="money-sub">年収をあまり重視しなかったため、金額換算は省略しました。</p>`
      : `<p class="money-sub">＝その条件のために、これだけの年収を諦めてもよいと考えた、という目安です。</p>`;

    const dHi = ex.decisive.most_hesitated_qid, dLo = ex.decisive.fastest_qid;
    const qById = {}; DATA.questions.forEach(q=>qById[q.id]=q);
    const qDesc = q=>{ if(!q) return ""; const f=j=>`年収${j.income}/${j.location==="なし"?"転勤なし":"転勤あり"}/${j.hours==="少"?"残業少":"残業多"}`; return `「${f(q.A)}」 vs 「${f(q.B)}」`; };

    const cards = [
      { kicker:"DISCOVERY 1 / 5", title:"あなたの重視度コンパス",
        html:`<p class="lead">${answers.filter(ans=>{const q=qById[ans.q_id];return q&&q.scored;}).length}回の選択から、各条件の重みを推定しました。外側ほど重視しています。</p><div class="radar-wrap">${radarSVG}</div>` },
      { kicker:"DISCOVERY 2 / 5", title:"お金に換算すると",
        html:`<p class="lead">あなたの選択を年収（30歳頃・額面）に換算しました。</p><div class="money">${moneyRows}</div>${incNote}` },
      { kicker:"DISCOVERY 3 / 5", title:"決定的だった瞬間",
        html:`<div class="moment"><div class="m-tag">いちばん悩んだ選択</div><div class="m-body">${qDesc(qById[dHi])}</div></div><div class="moment fast"><div class="m-tag">迷わず選んだ選択</div><div class="m-body">${qDesc(qById[dLo])}</div></div>` },
      { kicker:"DISCOVERY 4 / 5", title:"譲れない線、出せる線",
        html:`<div class="cols"><div class="box keep"><h4>譲りにくい条件</h4><ul>${ex.verbal.keep.map(s=>`<li>${s}</li>`).join("")}</ul></div><div class="box trade"><h4>交換に出しやすい条件</h4><ul>${ex.verbal.tradeable.map(s=>`<li>${s}</li>`).join("")}</ul></div></div><p class="money-sub" style="margin-top:14px">${mdBold(ex.verbal.text)}</p>` },
      { kicker:"DISCOVERY 5 / 5", title:"いま行ったことの種明かし",
        html:`<div class="reveal-box">いま行ったのは<strong>離散選択実験（DCE）</strong>です。複数条件を同時に動かす二択を繰り返すことで、口で言う重視度ではなく<strong>実際の選択から</strong>重みを逆算しています。</div>` }
    ];

    let i=0;
    const cardEl=$("#reveal-card"), dotsEl=$("#reveal-dots"), nextEl=$("#reveal-next");
    dotsEl.innerHTML=cards.map(()=>'<span class="dot"></span>').join("");
    function renderCard(){
      const c=cards[i];
      cardEl.innerHTML=`<div class="kicker">${c.kicker}</div><h2>${c.title}</h2>${c.html}`;
      cardEl.classList.remove("turn"); void cardEl.offsetWidth; cardEl.classList.add("turn");
      Array.prototype.forEach.call(dotsEl.children,(d,k)=>d.classList.toggle("on",k===i));
      const poly=cardEl.querySelector("#dpoly"); if(poly) setTimeout(()=>poly.classList.add("show"),300);
      nextEl.textContent = i<cards.length-1 ? "次の発見へ →" : "結果に納得できるか答える →";
    }
    nextEl.onclick=function(){ if(i<cards.length-1){ i++; renderCard(); } else { show("confirm"); } };
    renderCard();
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
    const est=estResult.est, ex=estResult.extras;
    return {
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      framing: META.framing,
      question_order: SEQUENCE.map(q=>q.id),
      answers: answers,
      estimate: { method:"binary_logit_ridge", lambda:0.5, beta:est.beta, mrs_manyen:est.mrs_manyen, importance_rank:est.importance_rank },
      counts: ex.counts,
      decisive: ex.decisive,
      quality: ex.quality,
      feedback: { agreement: agreement, free_text: freeText },
      app_version: "0.2"
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
    bindConfirm();
  });
})();
