import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import E from "../estimate.js";

const data = JSON.parse(readFileSync(new URL("../questions.json", import.meta.url)));

// 「在宅と残業少を常に守り、年収は手放す」回答を合成
function lifestyleChoice(q){
  for(const k of ["hours","remote","location"]){
    const good={hours:"少",remote:"可",location:"なし"}[k];
    if(q.A[k]===good && q.B[k]!==good) return "A";
    if(q.B[k]===good && q.A[k]!==good) return "B";
  }
  return "A";
}
const answers = data.questions.map(q=>({ q_id:q.id, choice: q.type==="dominant"?"A":lifestyleChoice(q), response_ms:5000 }));

test("estimate は beta/mrs/rank を返す", () => {
  const r = E.estimate(data.questions, data.meta, answers);
  assert.ok(r.beta && typeof r.beta.hours==="number");
  assert.ok(r.importance_rank.indexOf("hours")<=1, "hoursが上位");
  assert.ok(r.importance_rank.indexOf("remote")<=2, "remoteが上位");
});

test("MRSは万円・有限、年収軽視時はnull化を考慮", () => {
  const r = E.estimate(data.questions, data.meta, answers);
  for(const k of Object.keys(r.mrs_manyen)){
    const v=r.mrs_manyen[k];
    assert.ok(v===null || (Number.isFinite(v) && Math.abs(v)<=500), `${k}=${v}`);
  }
});

test("決定的瞬間と品質を返す", () => {
  // 1問だけ極端に長い応答時間にして「最も悩んだ」に出るか
  const ans2 = answers.map((a,i)=> i===3 ? {...a, response_ms:30000} : {...a, response_ms:3000});
  const r = E.estimate(data.questions, data.meta, ans2);
  const ex = E.extras(data.questions, data.meta, ans2, r);
  assert.ok(ex.decisive.most_hesitated_qid, "悩んだ設問IDがある");
  const mainIds = new Set(data.questions.filter(q=>q.scored).map(q=>q.id));
  assert.ok(mainIds.has(ex.decisive.most_hesitated_qid), "悩んだ設問は本番設問");
  assert.ok(ex.quality.logit_count_divergence>=0 && ex.quality.logit_count_divergence<=1, "乖離は0〜1");
  assert.equal(typeof ex.quality.dominant_passed, "boolean");
  assert.ok(ex.verbal.keep.length>=1 && ex.verbal.tradeable.length>=1);
});
