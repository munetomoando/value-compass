import { writeFileSync } from "node:fs";

// 決定論PRNG（mulberry32）
function rng(seed){ return function(){ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

const META = {
  app_version: "0.2",
  framing: {
    income_anchor: "age30_gross",
    family_assumption: "none_current_self",
    note: "年収はその仕事に就いた30歳頃の額面。転勤・在宅などはその仕事がずっと持つ特徴。特定の家族構成は仮定せず、今のあなたの感覚で。"
  },
  attributes: {
    income:   { label:"年収", unit:"万円", levels:{ "300":"年収300万", "450":"年収450万", "600":"年収600万", "750":"年収750万" }, kind:"continuous", good:"max" },
    location: { label:"勤務地・転勤", levels:{ "なし":"転勤なし・地元", "あり":"転勤あり・全国" }, kind:"binary", good:"なし" },
    hours:    { label:"労働時間", levels:{ "少":"残業少（〜月10h）", "多":"残業多（〜月45h）" }, kind:"binary", good:"少" },
    remote:   { label:"在宅勤務", levels:{ "可":"在宅可", "不可":"出社のみ" }, kind:"binary", good:"可" },
    growth:   { label:"成長・裁量", levels:{ "大":"裁量大・成長機会多", "小":"言われた業務中心" }, kind:"binary", good_nominal:"大", subjective:true },
    stability:{ label:"雇用安定性", levels:{ "安定":"安定（大手・終身的）", "不安定":"成長ベンチャー（不安定）" }, kind:"binary", good_nominal:"安定", subjective:true }
  },
  attribute_order: ["income","location","hours","remote","growth","stability"]
};

const INCOME = ["300","450","600","750"];
const BIN = {
  location:["なし","あり"], hours:["少","多"], remote:["可","不可"],
  growth:["大","小"], stability:["安定","不安定"]
};
const BIN_KEYS = Object.keys(BIN);

const GOOD = { location:"なし", hours:"少", remote:"可", growth:"大", stability:"安定" };

function randProfile(r){
  const p = { income: INCOME[Math.floor(r()*INCOME.length)] };
  for(const k of BIN_KEYS) p[k] = BIN[k][Math.floor(r()*2)];
  return p;
}

function betterSide(attr,a,b){
  if(attr==="income") return (+a.income>=+b.income)?"A":"B";
  if(a[attr]===GOOD[attr]) return "A";
  if(b[attr]===GOOD[attr]) return "B";
  return null;
}

function diffs(a,b){ return META.attribute_order.filter(k=> a[k]!==b[k]); }

function isDominant(a,b){
  const ds = diffs(a,b); if(ds.length===0) return true;
  const sides = ds.map(k=>betterSide(k,a,b));
  return sides.every(s=>s==="A") || sides.every(s=>s==="B");
}

function makePair(r){
  for(let t=0;t<200;t++){
    const a=randProfile(r), b=randProfile(r);
    const d=diffs(a,b).length;
    if(d>=2 && d<=5 && !isDominant(a,b)) return {A:a,B:b};
  }
  return null;
}

function penalty(mains){
  let pen=0;
  for(const k of BIN_KEYS){
    const n = mains.filter(q=>q.A[k]!==q.B[k]).length;
    const target=11; pen += Math.abs(n-target);
  }
  const incBranch = mains.filter(q=>q.A.income!==q.B.income).length;
  pen += Math.abs(incBranch-13);
  const cnt = Object.fromEntries(INCOME.map(v=>[v,0]));
  for(const q of mains){ cnt[q.A.income]++; cnt[q.B.income]++; }
  const avg = (16*2)/4;
  pen += INCOME.reduce((s,v)=>s+Math.abs(cnt[v]-avg),0)*0.5;
  return pen;
}

function buildMains(seed){
  const r=rng(seed);
  let best=null, bestPen=Infinity;
  for(let restart=0; restart<4000; restart++){
    const mains=[];
    for(let i=0;i<16;i++){ const p=makePair(r); if(p) mains.push(p); }
    if(mains.length<16) continue;
    const pen=penalty(mains);
    if(pen<bestPen){ bestPen=pen; best=mains; if(pen<=6) break; }
  }
  return { mains:best, pen:bestPen };
}

function build(){
  const { mains, pen } = buildMains(20260602);
  if(!mains) throw new Error("設問生成に失敗");
  const questions = [];
  questions.push({ id:"practice", type:"practice", scored:false, intent:"操作に慣れる",
    A:{income:"450",location:"なし",hours:"少",remote:"可",growth:"小",stability:"安定"},
    B:{income:"450",location:"あり",hours:"多",remote:"不可",growth:"大",stability:"不安定"} });
  mains.forEach((m,i)=> questions.push({ id:"q"+String(i+1).padStart(2,"0"), type:"main", scored:true,
    intent:"トレードオフ", A:m.A, B:m.B }));
  questions.push({ id:"qd", type:"dominant", scored:false, intent:"注意チェック（Aが全優位）",
    A:{income:"750",location:"なし",hours:"少",remote:"可",growth:"大",stability:"安定"},
    B:{income:"300",location:"あり",hours:"多",remote:"不可",growth:"小",stability:"不安定"} });

  writeFileSync(new URL("./questions.json",import.meta.url),
    JSON.stringify({ meta:META, questions }, null, 2)+"\n");
  console.log("生成完了 penalty=",pen);
}
build();
