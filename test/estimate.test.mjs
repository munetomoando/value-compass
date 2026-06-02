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
