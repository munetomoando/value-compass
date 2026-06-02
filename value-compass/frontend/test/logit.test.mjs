import { test } from "node:test";
import assert from "node:assert";
import pkg from "../estimate.js";
const { fitLogit } = pkg;

function sigmoid(z){ return 1/(1+Math.exp(-z)); }
test("既知の係数を概ね回復する", () => {
  const trueBeta = [0.0, 0.8, 1.5, 1.0]; // [切片, x1, x2, x3]
  const X=[], y=[];
  let s=12345; const rnd=()=>{ s=(s*1103515245+12345)&0x7fffffff; return s/0x7fffffff; };
  for(let i=0;i<800;i++){
    const x=[1, rnd()*2-1, rnd()*2-1, rnd()*2-1];
    const p=sigmoid(x.reduce((a,b,j)=>a+b*trueBeta[j],0));
    X.push(x); y.push(rnd()<p?1:0);
  }
  const beta = fitLogit(X, y, { lambda:0.01, penalizeIntercept:false });
  assert.ok(Math.abs(beta[1]-0.8)<0.3, `x1 ${beta[1]}`);
  assert.ok(Math.abs(beta[2]-1.5)<0.4, `x2 ${beta[2]}`);
  assert.ok(Math.abs(beta[3]-1.0)<0.4, `x3 ${beta[3]}`);
});

test("完全分離でも有限の係数を返す（リッジ）", () => {
  const X=[], y=[];
  for(let i=0;i<20;i++){ const x1=(i<10?-1:1); X.push([1,x1]); y.push(x1>0?1:0); }
  const beta = fitLogit(X, y, { lambda:1.0, penalizeIntercept:false });
  assert.ok(Number.isFinite(beta[1]) && Math.abs(beta[1])<50, `分離でも有限: ${beta[1]}`);
});
