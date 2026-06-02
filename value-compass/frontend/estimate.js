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
      const d=M[c][c]||1e-9;
      for(let j=c;j<=n;j++) M[c][j]/=d;
      for(let r=0;r<n;r++){ if(r===c) continue; const f=M[r][c];
        for(let j=c;j<=n;j++) M[r][j]-=f*M[c][j]; }
    }
    return M.map(row=>row[n]);
  }

  // 罰則付き二項ロジットの最尤（Newton-Raphson / IRLS）
  function fitLogit(X, y, opts){
    opts = opts || {};
    const lambda = opts.lambda==null ? 0.5 : opts.lambda;
    const penalizeIntercept = !!opts.penalizeIntercept;
    const maxIter = opts.maxIter || 50;
    const p = X[0].length;
    let beta = new Array(p).fill(0);
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
      if(maxd<1e-7) break;
    }
    return beta;
  }

  return { fitLogit, solve };
});
