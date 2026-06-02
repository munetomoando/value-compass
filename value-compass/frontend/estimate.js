/*
 * estimate.js — カウントベース簡易効用推定（設計書 §6.1, §6.3）
 *
 * 推定方針：
 *   各属性について「その属性がA/Bで異なった設問（=分岐設問）」を抽出し、
 *   そのうち『良い水準側』を選んだ割合を score[a] (0〜1) とする。
 *   - income/location/hours/remote は良い水準が固定。
 *   - growth/stability は『良い水準』に個人差があるため、名目上の good
 *     （裁量大 / 安定）側を選んだ割合を score として記録しつつ、
 *     どちらに振れたか（方向）を別途返す（設計書 §5.5 の「両方向で記録」）。
 *
 *   重視度ランキングは「選択の一貫性」= |score - 0.5| * 2 を用いる。
 *   ある属性を常に守った/常に手放した人ほど、その属性が判断軸になっている。
 *   score≈0.5（守ったり手放したり半々）は、その属性の優先度が低いと解釈する。
 */

(function (global) {
  "use strict";

  // 年収の数値化（良い水準＝高いほう）
  function incomeValue(v) { return parseInt(v, 10); }

  // ある設問で「属性 a の良い水準」を持つ選択肢（"A" or "B"）を返す。
  // 良い水準が一意に決まらない（subjective で名目 good を使う）場合も、
  // 名目 good 側の選択肢を返す。
  function betterSide(attr, meta, qa, qb) {
    const def = meta.attributes[attr];
    if (attr === "income") {
      return incomeValue(qa) >= incomeValue(qb) ? "A" : "B";
    }
    const good = def.good || def.good_nominal;
    if (qa === good) return "A";
    if (qb === good) return "B";
    return null;
  }

  function estimate(questions, meta, answers) {
    const answerById = {};
    answers.forEach(function (ans) { answerById[ans.q_id] = ans; });

    const scoredQs = questions.filter(function (q) { return q.scored; });

    const scores = {};        // attr -> 0..1（名目good側を選んだ割合）
    const branchCount = {};   // attr -> 分岐設問数
    const importance = {};    // attr -> 一貫性 0..1

    meta.attribute_order.forEach(function (attr) {
      let relevant = 0;
      let chosenBetter = 0;

      scoredQs.forEach(function (q) {
        const va = q.A[attr];
        const vb = q.B[attr];
        if (va === vb) return; // 分岐していない設問は対象外
        relevant += 1;
        const ans = answerById[q.id];
        if (!ans) return;
        const better = betterSide(attr, meta, va, vb);
        if (better && ans.choice === better) chosenBetter += 1;
      });

      branchCount[attr] = relevant;
      const score = relevant > 0 ? chosenBetter / relevant : null;
      scores[attr] = score;
      importance[attr] = score === null ? 0 : Math.abs(score - 0.5) * 2;
    });

    // 重視度ランキング（一貫性の高い順）
    const ranking = meta.attribute_order.slice().sort(function (a, b) {
      return importance[b] - importance[a];
    });

    // subjective 属性の方向ラベル
    const direction = {};
    if (scores.growth !== null) {
      direction.growth = scores.growth >= 0.5
        ? "裁量・成長を取りにいく傾向"
        : "言われた業務でも安定を選ぶ傾向";
    }
    if (scores.stability !== null) {
      direction.stability = scores.stability >= 0.5
        ? "雇用の安定を重視する傾向"
        : "不安定でも成長機会を取る傾向";
    }

    return {
      scores: scores,
      branch_count: branchCount,
      importance: importance,
      ranking: ranking,
      direction: direction
    };
  }

  // 品質チェック（設計書 §6.3）
  function qualityCheck(questions, answers) {
    const answerById = {};
    answers.forEach(function (ans) { answerById[ans.q_id] = ans; });

    // 支配選択（q7 = type:dominant）。良い側＝A。BならフラグL
    const dominantQ = questions.find(function (q) { return q.type === "dominant"; });
    let dominantPassed = true;
    if (dominantQ && answerById[dominantQ.id]) {
      dominantPassed = answerById[dominantQ.id].choice === "A";
    }

    const times = answers
      .map(function (a) { return a.response_ms; })
      .filter(function (t) { return typeof t === "number"; });
    const minResponseMs = times.length ? Math.min.apply(null, times) : null;

    // 一貫性フラグ（MVP簡易版）：採点対象の明確good属性のうち、
    // 選択が半々（0.4〜0.6）に割れた属性数を、判断の揺れの目安として数える。
    // 本格的な相反ペア検出は v1 で実装（設計書 §6.2/§6.3）。
    return {
      dominant_passed: dominantPassed,
      min_response_ms: minResponseMs
    };
  }

  // 結果の言語化（設計書 §7）
  function verbalize(questions, meta, est) {
    const A = meta.attributes;
    const labelOf = {
      income: "年収",
      location: "勤務地（転勤の少なさ）",
      hours: "労働時間の短さ",
      remote: "在宅勤務",
      growth: "裁量・成長機会",
      stability: "雇用の安定性"
    };

    const ranked = est.ranking.filter(function (a) { return est.scores[a] !== null; });
    const top = ranked.slice(0, 2);
    const bottom = ranked.slice(-2);

    function phrase(attr) {
      if (attr === "growth" && est.direction.growth) return labelOf[attr] + "（" + est.direction.growth + "）";
      if (attr === "stability" && est.direction.stability) return labelOf[attr] + "（" + est.direction.stability + "）";
      return labelOf[attr];
    }

    let text = "あなたの選択からは、" +
      "**" + phrase(top[0]) + "**" + (top[1] ? "と**" + phrase(top[1]) + "**" : "") +
      "を特に重視する傾向が読み取れました。";

    text += "一方で、**" + labelOf[bottom[bottom.length - 1]] + "**は相対的に優先度が低く、" +
      "他の条件と引き換えに手放す選択が目立ちました。";

    // 年収の位置づけ
    if (est.scores.income !== null) {
      const incRank = est.ranking.indexOf("income");
      const incDesc = incRank <= 1 ? "強く重視している" : (incRank >= 4 ? "あまり重視していない" : "中程度に重視している");
      text += "年収については" + incDesc + "様子がうかがえます。";
    }

    return {
      text: text,
      keep: top.map(function (a) { return phrase(a); }),       // 譲りにくい条件
      tradeable: bottom.map(function (a) { return phrase(a); }) // 交換に出しやすい条件
    };
  }

  global.ValueCompassEstimate = {
    estimate: estimate,
    qualityCheck: qualityCheck,
    verbalize: verbalize
  };
})(typeof window !== "undefined" ? window : this);
