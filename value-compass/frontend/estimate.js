/* estimate.js — ロジット推定・MRS・決定的瞬間（設計書 v0.2 §6） */
(function (root, factory){
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.ValueCompassEstimate = api;
})(this, function(){
  "use strict";

  // 小規模線形方程式 Ax=b をガウス消去で解く（A: n×n, b: n）
  function solve(A, b){
    const n=b.length, M=A.map((row,i)=>row.concat(b[i]));
    for(let c=0;c<n;c++){
      let piv=c; for(let r=c+1;r<n;r++) if(Math.abs(M[r][c])>Math.abs(M[piv][c])) piv=r;
      [M[c],M[piv]]=[M[piv],M[c]];
      const d = (Number.isFinite(M[c][c]) && M[c][c] !== 0) ? M[c][c] : 1e-9;
      for(let j=c;j<=n;j++) M[c][j]/=d;
      for(let r=0;r<n;r++){ if(r===c) continue; const f=M[r][c];
        for(let j=c;j<=n;j++) M[r][j]-=f*M[c][j]; }
    }
    return M.map(row=>row[n]);
  }

  // 罰則付き二項ロジットの最尤（Newton-Raphson / IRLS）
  function fitLogit(X, y, opts){
    if (!X || X.length === 0) throw new Error("fitLogit: X must be non-empty");
    opts = opts || {};
    const lambda = opts.lambda==null ? 0.5 : opts.lambda;
    const penalizeIntercept = !!opts.penalizeIntercept;
    const maxIter = opts.maxIter || 50;
    const p = X[0].length;
    let beta = new Array(p).fill(0);
    let converged = false;
    for(let it=0; it<maxIter; it++){
      const g = new Array(p).fill(0);            // 勾配
      const H = Array.from({length:p},()=>new Array(p).fill(0)); // -ヘッセ
      for(let i=0;i<X.length;i++){
        let eta=0; for(let j=0;j<p;j++) eta+=X[i][j]*beta[j];
        const mu=1/(1+Math.exp(-eta)); const w=Math.max(mu*(1-mu),1e-6);
        for(let j=0;j<p;j++){
          g[j]+=X[i][j]*(y[i]-mu);
          for(let k=0;k<p;k++) H[j][k]+=X[i][j]*X[i][k]*w;
        }
      }
      for(let j=0;j<p;j++){
        const pen = (penalizeIntercept || j!==0) ? lambda : 0;
        g[j]-=pen*beta[j]; H[j][j]+=pen;
      }
      const step = solve(H, g);
      let maxd=0; for(let j=0;j<p;j++){ beta[j]+=step[j]; maxd=Math.max(maxd,Math.abs(step[j])); }
      if(maxd<1e-7){ converged=true; break; }
    }
    if(!converged) console.warn("fitLogit: 収束しませんでした (maxIter到達)");
    return beta;
  }

  // 属性値→数値（incomeは100万単位、二値はgood=1/bad=0、subjectiveは名目good=1）
  function code(meta, attr, val){
    const def = meta.attributes[attr];
    if(!def) return 0;
    if(attr==="income") return (+val)/100;
    const good = def.good || def.good_nominal;
    return val===good ? 1 : 0;
  }

  function designRow(meta, q){
    return meta.attribute_order.map(a => code(meta,a,q.A[a]) - code(meta,a,q.B[a]));
  }

  function std(arr){
    if(!arr.length) return 0;
    const m=arr.reduce((a,b)=>a+b,0)/arr.length;
    return Math.sqrt(arr.reduce((s,x)=>s+(x-m)*(x-m),0)/arr.length);
  }

  function estimate(questions, meta, answers){
    const ansById = {}; answers.forEach(a=>ansById[a.q_id]=a);
    const mains = questions.filter(q=>q.scored);
    const order = meta.attribute_order;

    const Xdiff=[], X=[], y=[];
    for(const q of mains){
      const a=ansById[q.id]; if(!a) continue;
      const d=designRow(meta,q);
      Xdiff.push(d); X.push([1,...d]); y.push(a.choice==="A"?1:0);
    }
    const beta_full = fitLogit(X, y, { lambda:0.5, penalizeIntercept:false });
    const beta = {}; order.forEach((a,i)=> beta[a]=beta_full[i+1]); // 切片を除く

    // 重要度（スケール非依存）= |β_k| * sd(差分列_k)、最大1に正規化
    const imp={};
    order.forEach((a,i)=>{ imp[a]=Math.abs(beta[a])*std(Xdiff.map(r=>r[i])); });
    const maxImp=Math.max(...Object.values(imp),1e-9);
    const importance={}; order.forEach(a=> importance[a]=imp[a]/maxImp);
    const importance_rank = order.slice().sort((a1,a2)=>importance[a2]-importance[a1]);

    // MRS（万円）= β_attr/β_income * 100。年収軽視時はnull、極端値はクリップ
    const bInc = beta.income;
    const mrs_manyen={};
    for(const a of order){
      if(a==="income") continue;
      if(!Number.isFinite(bInc) || bInc<0.02){ mrs_manyen[a]=null; continue; } // β_income≦0は金額換算が無意味→null
      let v=(beta[a]/bInc)*100;
      if(!Number.isFinite(v)){ mrs_manyen[a]=null; continue; }
      mrs_manyen[a]=Math.max(-500,Math.min(500, Math.round(v/5)*5));
    }

    return { beta, importance, importance_rank, mrs_manyen,
             _design:{ Xdiff, beta_full, mainsIds: mains.map(q=>q.id) } // デバッグ用・外部仕様外
           };
  }

  function zscores(arr){
    const m=arr.reduce((a,b)=>a+b,0)/arr.length;
    const sd=std(arr)||1e-9;
    return arr.map(x=>(x-m)/sd);
  }

  // 決定的瞬間＋品質＋言語化（estimateの結果estを使う）
  function extras(questions, meta, answers, est){
    const ansById={}; answers.forEach(a=>ansById[a.q_id]=a);
    const mains = questions.filter(q=>q.scored);
    // 本人の効用での僅差度 |β·d|
    const ids=[], gaps=[], times=[];
    mains.forEach(q=>{
      const a=ansById[q.id]; if(!a) return;
      const d=designRow(meta,q);
      let u=0; meta.attribute_order.forEach((attr,i)=> u+=est.beta[attr]*d[i]);
      ids.push(q.id); gaps.push(Math.abs(u)); times.push(a.response_ms||0);
    });
    const zg=zscores(gaps), zt=zscores(times);
    let hi=0, lo=0;
    ids.forEach((_,i)=>{ if((zt[i]-zg[i])>(zt[hi]-zg[hi])) hi=i; if((zg[i]-zt[i])>(zg[lo]-zt[lo])) lo=i; });
    const decisive = { most_hesitated_qid: ids[hi]||null, fastest_qid: ids[lo]||null };

    // 品質：支配選択passed、最小応答時間、ロジット×カウント乖離
    const dom = questions.find(q=>q.type==="dominant");
    const dominant_passed = dom && ansById[dom.id] ? ansById[dom.id].choice==="A" : true;
    const allTimes = answers.map(a=>a.response_ms).filter(t=>typeof t==="number");
    const min_response_ms = allTimes.length?Math.min(...allTimes):null;
    // カウントベース順位（v0.1方式）との乖離
    const counts={}; meta.attribute_order.forEach(attr=>{
      let rel=0,good=0;
      mains.forEach(q=>{ if(q.A[attr]===q.B[attr])return; rel++;
        const a=ansById[q.id]; if(!a)return;
        const bs = attr==="income" ? (+q.A.income>=+q.B.income?"A":"B")
          : (q.A[attr]===(meta.attributes[attr].good||meta.attributes[attr].good_nominal)?"A":"B");
        if(a.choice===bs) good++; });
      counts[attr]= rel?good/rel:0.5;
    });
    const cRank=meta.attribute_order.slice().sort((p,q)=>Math.abs(counts[q]-0.5)-Math.abs(counts[p]-0.5));
    let div=0; est.importance_rank.forEach((a,i)=> div+=Math.abs(i-cRank.indexOf(a)));
    const logit_count_divergence = +(div/(meta.attribute_order.length*meta.attribute_order.length)).toFixed(2);

    // 言語化：上位2=譲れない、下位2=出しやすい
    const label={income:"年収",location:"勤務地（転勤の少なさ）",hours:"労働時間の短さ",remote:"在宅勤務",growth:"裁量・成長機会",stability:"雇用の安定性"};
    const dir={};
    if(Number.isFinite(est.beta.growth)) dir.growth = est.beta.growth>=0?"裁量・成長を取りにいく傾向":"言われた業務でも安定を選ぶ傾向";
    if(Number.isFinite(est.beta.stability)) dir.stability = est.beta.stability>=0?"雇用の安定を重視する傾向":"不安定でも成長機会を取る傾向";
    const ranked=est.importance_rank;
    const phrase=a=> (a==="growth"&&dir.growth)?`${label[a]}（${dir.growth}）`:(a==="stability"&&dir.stability)?`${label[a]}（${dir.stability}）`:label[a];
    const keep=ranked.slice(0,2).map(phrase);
    const tradeable=ranked.slice(-2).map(phrase);
    const text=`あなたの選択からは、**${phrase(ranked[0])}**と**${phrase(ranked[1])}**を特に重視する傾向が読み取れました。一方で**${label[ranked[ranked.length-1]]}**は相対的に優先度が低く、他条件と引き換えに手放す選択が目立ちました。`;

    return { decisive, quality:{ dominant_passed, min_response_ms, logit_count_divergence }, counts, verbal:{ text, keep, tradeable, direction:dir, label } };
  }

  return { fitLogit, solve, estimate, extras, designRow, code };
});
