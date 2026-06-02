import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(new URL("../questions.json", import.meta.url)));
const { meta, questions } = data;
const mains = questions.filter(q=>q.scored);

test("本番16問・練習1・支配1の構成", () => {
  assert.equal(mains.length, 16);
  assert.equal(questions.filter(q=>q.type==="practice").length, 1);
  assert.equal(questions.filter(q=>q.type==="dominant").length, 1);
});

test("全6属性が十分に分岐する（8〜14回）", () => {
  for (const a of meta.attribute_order) {
    const n = mains.filter(q=>q.A[a]!==q.B[a]).length;
    assert.ok(n>=8 && n<=14, `${a} の分岐 ${n} が範囲外`);
  }
});

test("income 4水準すべてが出現する", () => {
  const seen = new Set();
  for (const q of mains){ seen.add(q.A.income); seen.add(q.B.income); }
  assert.deepEqual([...seen].sort(), ["300","450","600","750"]);
});

test("本番に支配ペア（トレードオフ無し）が無い", () => {
  const GOOD = { location:"なし", hours:"少", remote:"可", growth:"大", stability:"安定" };
  const better=(attr,a,b)=> attr==="income" ? (+a.income>=+b.income?"A":"B") : (a[attr]===GOOD[attr]?"A":(b[attr]===GOOD[attr]?"B":null));
  for (const q of mains){
    const ds = meta.attribute_order.filter(k=>q.A[k]!==q.B[k]);
    const sides = ds.map(k=>better(k,q.A,q.B));
    assert.ok(!(sides.every(s=>s==="A")||sides.every(s=>s==="B")), `${q.id} が支配的`);
  }
});

test("支配選択qdはAが全属性で良い", () => {
  const q = questions.find(q=>q.type==="dominant");
  const GOOD = { location:"なし", hours:"少", remote:"可", growth:"大", stability:"安定" };
  assert.ok(+q.A.income > +q.B.income);
  for (const a of ["location","hours","remote","growth","stability"]) assert.equal(q.A[a], GOOD[a]);
});
