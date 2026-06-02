import { test } from "node:test";
import assert from "node:assert";
import R from "../radar.js";

test("6項目で六角形のグリッドとデータ多角形を生成", () => {
  const items=[["A",1],["B",.5],["C",.3],["D",.8],["E",.2],["F",.6]].map(([label,value])=>({label,value}));
  const svg = R.buildRadarSVG(items);
  assert.match(svg, /<svg/);
  assert.ok((svg.match(/<polygon/g)||[]).length>=5, "グリッド+データ多角形");
  assert.ok(svg.includes("data-poly"), "データ多角形クラス");
  items.forEach(it=> assert.ok(svg.includes(it.label), `${it.label}ラベル`));
});

test("value=0でも例外を出さない", () => {
  const items=Array.from({length:6},(_,i)=>({label:"x"+i, value:0}));
  assert.doesNotThrow(()=>R.buildRadarSVG(items));
});

test("value>1はクランプされ value=1と同じSVGになる", () => {
  const ones=Array.from({length:6},(_,i)=>({label:"x"+i, value:1}));
  const twos=Array.from({length:6},(_,i)=>({label:"x"+i, value:2}));
  assert.equal(R.buildRadarSVG(twos), R.buildRadarSVG(ones));
});

test("項目が少なすぎる場合は空SVGを返す（例外なし）", () => {
  assert.doesNotThrow(()=>R.buildRadarSVG([]));
  assert.match(R.buildRadarSVG([]), /<svg/);
});
