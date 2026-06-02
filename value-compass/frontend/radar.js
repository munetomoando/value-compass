/* radar.js — レーダーチャート（SVG）描画 純関数 */
(function (root, factory){
  const api=factory();
  if (typeof module!=="undefined" && module.exports) module.exports=api;
  if (typeof window!=="undefined") window.ValueCompassRadar=api;
})(this, function(){
  "use strict";
  const CX=160, CY=150, R=100, LR=128;
  function buildRadarSVG(items){
    const n=items.length;
    const ang=items.map((_,i)=> (-90 + i*(360/n)) * Math.PI/180);
    const pt=(r,i)=>[ +(CX+r*Math.cos(ang[i])).toFixed(1), +(CY+r*Math.sin(ang[i])).toFixed(1) ];
    let s=`<svg viewBox="0 0 320 300" width="300" height="282" role="img" aria-label="重視度レーダー">`;
    [0.25,0.5,0.75,1].forEach(ring=>{
      const p=items.map((_,i)=>pt(R*ring,i).join(",")).join(" ");
      s+=`<polygon class="grid-line" points="${p}"/>`;
    });
    items.forEach((_,i)=>{ const [x,y]=pt(R,i); s+=`<line class="axis-line" x1="${CX}" y1="${CY}" x2="${x}" y2="${y}"/>`; });
    const dp=items.map((d,i)=>pt(R*Math.max(0,Math.min(1,d.value)),i).join(",")).join(" ");
    s+=`<polygon class="data-poly" id="dpoly" points="${dp}"/>`;
    items.forEach((d,i)=>{ const [x,y]=pt(R*Math.max(0,Math.min(1,d.value)),i); s+=`<circle class="data-dot" cx="${x}" cy="${y}" r="3"/>`; });
    items.forEach((d,i)=>{ const [x,y]=pt(LR,i); const c=Math.cos(ang[i]), sn=Math.sin(ang[i]);
      const anchor=c>0.3?"start":(c<-0.3?"end":"middle"); const dy=sn<-0.3?-2:(sn>0.3?12:4);
      s+=`<text class="axis-label${i===0?" top1":""}" x="${x}" y="${y+dy}" text-anchor="${anchor}">${d.label}</text>`; });
    return s+`</svg>`;
  }
  return { buildRadarSVG };
});
