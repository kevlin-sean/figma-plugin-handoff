/* Geometry in parent-local coordinates. Measured distances are never CSS margins. */
(function(root){
'use strict';
const EPS=1e-6,SIDES=['top','right','bottom','left'];
const identity=[[1,0,0],[0,1,0]];
function matrix(n){if(n?.absoluteTransform)return n.absoluteTransform;const b=n?.absoluteBoundingBox;return b?[[1,0,b.x],[0,1,b.y]]:identity;}
function point(t,p){return{x:t[0][0]*p.x+t[0][1]*p.y+t[0][2],y:t[1][0]*p.x+t[1][1]*p.y+t[1][2]};}
function inverse(t){const a=t[0][0],b=t[1][0],c=t[0][1],d=t[1][1],x=t[0][2],y=t[1][2],det=a*d-b*c;if(Math.abs(det)<EPS)return null;return[[d/det,-c/det,(c*y-d*x)/det],[-b/det,a/det,(b*x-a*y)/det]];}
function rect(n,inv){const t=matrix(n),p=[[0,0],[n.width,0],[n.width,n.height],[0,n.height]].map(([x,y])=>point(inv,point(t,{x,y})));const x=Math.min(...p.map(p=>p.x)),y=Math.min(...p.map(p=>p.y)),right=Math.max(...p.map(p=>p.x)),bottom=Math.max(...p.map(p=>p.y));return{x,y,right,bottom,width:right-x,height:bottom-y,approximate:Math.abs(p[0].y-p[1].y)>EPS||Math.abs(p[1].x-p[2].x)>EPS};}
function intersect(a,b){return Math.min(a.right,b.right)-Math.max(a.x,b.x)>EPS&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>EPS;}
function line(kind,side,value,a,b,transform,other){return{kind,side,value,from:point(transform,a),to:point(transform,b),nodeId:other?.id,name:other?.name};}
function edgeLines(kind,values,b,w,h,t){const cx=(b.x+b.right)/2,cy=(b.y+b.bottom)/2;return[
 line(kind,'top',values.top,{x:cx,y:0},{x:cx,y:b.y},t),
 line(kind,'right',values.right,{x:b.right,y:cy},{x:w,y:cy},t),
 line(kind,'bottom',values.bottom,{x:cx,y:b.bottom},{x:cx,y:h},t),
 line(kind,'left',values.left,{x:0,y:cy},{x:b.x,y:cy},t)];}
function create(nodes,pages=[]){
 const byId=new Map(nodes.map(n=>[n.id,n])),children=new Map(),pageForRegion=new Map(),cache=new Map(),layoutCache=new Map();
 for(const p of pages)for(const id of p.regions)pageForRegion.set(id,p.id);
 function group(n){return n.parentId||'page:'+(n.pageId||pageForRegion.get(n.regionId)||n.regionId);}
 for(const n of nodes){const key=group(n);if(!children.has(key))children.set(key,[]);children.get(key).push(n);}
 function shown(n){for(let p=n;p;p=byId.get(p.parentId)){if(p.visible===false||p.opacity===0)return false;if(p.id!==n.id&&p.clipsContent){const inv=inverse(matrix(p));if(!inv||!intersect(rect(n,inv),{x:0,y:0,right:p.width,bottom:p.height}))return false;}}return !n.isMask&&n.width>0&&n.height>0;}
 function measure(id){
  if(cache.has(id))return cache.get(id);const n=byId.get(id);if(!n)return null;
  const parent=byId.get(n.parentId),t=parent?matrix(parent):identity,inv=inverse(t),ownInv=inverse(matrix(n));
  const result={nodeId:id,inner:null,parent:null,neighbors:{},overlapCount:0,lines:[],approximate:false,error:null};
  if(!inv||!ownInv){result.error='变换矩阵不可逆，无法测量';cache.set(id,result);return result;}
  const b=rect(n,inv);result.approximate=b.approximate;
  const padding=SIDES.reduce((v,side)=>{v[side]=n['padding'+side[0].toUpperCase()+side.slice(1)];return v;},{});
  const auto=['HORIZONTAL','VERTICAL','GRID'].includes(n.layoutMode);
  if(auto&&SIDES.every(s=>Number.isFinite(padding[s]))){
   result.inner={source:'padding',values:padding,layoutMode:n.layoutMode,gap:n.layoutMode==='GRID'?null:n.primaryAxisAlignItems==='SPACE_BETWEEN'?'AUTO':Number.isFinite(n.itemSpacing)?n.itemSpacing:null,crossGap:n.layoutWrap==='WRAP'&&Number.isFinite(n.counterAxisSpacing)?n.counterAxisSpacing:null,rowGap:n.layoutMode==='GRID'&&Number.isFinite(n.gridRowGap)?n.gridRowGap:null,columnGap:n.layoutMode==='GRID'&&Number.isFinite(n.gridColumnGap)?n.gridColumnGap:null};
  }else{
   const boxes=(children.get(n.id)||[]).filter(shown).map(c=>rect(c,ownInv));
   if(boxes.length){const content={x:Math.min(...boxes.map(b=>b.x)),y:Math.min(...boxes.map(b=>b.y)),right:Math.max(...boxes.map(b=>b.right)),bottom:Math.max(...boxes.map(b=>b.bottom))};result.inner={source:'content',values:{top:content.y,right:n.width-content.right,bottom:n.height-content.bottom,left:content.x}};result.approximate=result.approximate||boxes.some(b=>b.approximate);}
  }
  if(result.inner){const v=result.inner.values,content={x:v.left,y:v.top,right:n.width-v.right,bottom:n.height-v.bottom};result.lines.push(...edgeLines('inner',v,content,n.width,n.height,matrix(n)));}
  if(parent){const values={top:b.y,right:parent.width-b.right,bottom:parent.height-b.bottom,left:b.x};result.parent={nodeId:parent.id,name:parent.name,values};result.lines.push(...edgeLines('parent',values,b,parent.width,parent.height,t));}
  const candidates=(children.get(group(n))||[]).filter(c=>c.id!==id&&shown(c));
  function offer(side,distance,c,from,to){const old=result.neighbors[side];if(!old||distance<old.distance-EPS){const v=Math.abs(distance)<EPS?0:distance;result.neighbors[side]={nodeId:c.id,name:c.name,distance:v,line:line('neighbor',side,v,from,to,t,c)};}}
  for(const c of candidates){
   const q=rect(c,inv);if(intersect(b,q)){result.overlapCount++;continue;}
   const left=Math.max(b.x,q.x),right=Math.min(b.right,q.right),top=Math.max(b.y,q.y),bottom=Math.min(b.bottom,q.bottom);
   if(right-left>EPS){const x=(left+right)/2;if(q.bottom<=b.y+EPS)offer('top',b.y-q.bottom,c,{x,y:q.bottom},{x,y:b.y});if(q.y>=b.bottom-EPS)offer('bottom',q.y-b.bottom,c,{x,y:b.bottom},{x,y:q.y});}
   if(bottom-top>EPS){const y=(top+bottom)/2;if(q.right<=b.x+EPS)offer('left',b.x-q.right,c,{x:q.right,y},{x:b.x,y});if(q.x>=b.right-EPS)offer('right',q.x-b.right,c,{x:b.right,y},{x:q.x,y});}
  }
  for(const v of Object.values(result.neighbors))result.lines.push(v.line);
  cache.set(id,result);return result;
 }
 // Measure only the selected layer and the current hover target, like MeaXure.
 function between(id,targetId){
  const n=byId.get(id),q=byId.get(targetId);if(!n||!q||id===targetId||n.regionId!==q.regionId||(n.frameId&&q.frameId&&n.frameId!==q.frameId)||!shown(n)||!shown(q))return null;
  const t=matrix(byId.get(n.parentId)),inv=inverse(t);if(!inv)return null;
  const a=rect(n,inv),b=rect(q,inv),lines=[],cx=(a.x+a.right)/2,cy=(a.y+a.bottom)/2;
  const add=(side,value,from,to)=>{if(Math.abs(value)>EPS)lines.push(line('target',side,Math.abs(value),from,to,t,q));};
  if(intersect(a,b)){
   add('top',a.y-b.y,{x:cx,y:b.y},{x:cx,y:a.y});
   add('right',b.right-a.right,{x:a.right,y:cy},{x:b.right,y:cy});
   add('bottom',b.bottom-a.bottom,{x:cx,y:a.bottom},{x:cx,y:b.bottom});
   add('left',a.x-b.x,{x:b.x,y:cy},{x:a.x,y:cy});
  }else{
   const left=Math.max(a.x,b.x),right=Math.min(a.right,b.right),top=Math.max(a.y,b.y),bottom=Math.min(a.bottom,b.bottom),x=right>left?(left+right)/2:cx,y=bottom>top?(top+bottom)/2:cy;
   if(a.right<=b.x)add('right',b.x-a.right,{x:a.right,y},{x:b.x,y});
   if(b.right<=a.x)add('left',a.x-b.right,{x:b.right,y},{x:a.x,y});
   if(a.bottom<=b.y)add('bottom',b.y-a.bottom,{x,y:a.bottom},{x,y:b.y});
   if(b.bottom<=a.y)add('top',a.y-b.bottom,{x,y:b.bottom},{x,y:a.y});
  }
  return {nodeId:q.id,lines,approximate:a.approximate||b.approximate};
 }
 function frame(id){
  const n=byId.get(id),f=n&&byId.get(n.frameId||n.regionId);if(!n||!f||n.id===f.id)return null;
  const t=matrix(f),inv=inverse(t);if(!inv)return null;const b=rect(n,inv),values={top:b.y,right:f.width-b.right,bottom:f.height-b.bottom,left:b.x};
  return {nodeId:f.id,name:f.name,values,approximate:b.approximate,lines:edgeLines('frame',values,b,f.width,f.height,t)};
 }
 function layout(id){
  if(layoutCache.has(id))return layoutCache.get(id);
  const n=byId.get(id),inv=n&&inverse(matrix(n));if(!inv)return{bands:[],limited:false};
  const m=measure(id),bands=[],all=(children.get(id)||[]).filter(shown),list=all.slice(0,200).map(c=>({node:c,...rect(c,inv)}));
  if(m.inner){const v=m.inner.values,add=(side,x,y,width,height)=>{if(width>EPS&&height>EPS)bands.push({kind:'padding',side,source:m.inner.source,value:v[side],x,y,width,height});};
   add('top',0,0,n.width,Math.min(n.height,Math.max(0,v.top)));add('bottom',0,Math.max(0,n.height-v.bottom),n.width,Math.min(n.height,Math.max(0,v.bottom)));
   const top=Math.max(0,v.top),height=Math.max(0,n.height-top-Math.max(0,v.bottom));add('left',0,top,Math.min(n.width,Math.max(0,v.left)),height);add('right',Math.max(0,n.width-v.right),top,Math.min(n.width,Math.max(0,v.right)),height);
  }
  // Gaps use the actual nearest non-overlapping child edges, including wrapping
  // and space-between. The stored itemSpacing is never substituted for a gap.
  if(['HORIZONTAL','VERTICAL','GRID'].includes(n.layoutMode))for(const axis of ['x','y']){
   const primary=axis==='x',ordered=[...list].sort((a,b)=>(primary?a.x-b.x:a.y-b.y)),seen=new Set();
   for(const b of ordered){let best=null;
    for(const q of ordered){if(q===b)continue;const distance=primary?q.x-b.right:q.y-b.bottom,lo=primary?Math.max(b.y,q.y):Math.max(b.x,q.x),hi=primary?Math.min(b.bottom,q.bottom):Math.min(b.right,q.right);
     if(distance>EPS&&hi-lo>EPS&&(!best||distance<best.value))best={kind:'gap',axis,value:distance,x:primary?b.right:lo,y:primary?lo:b.bottom,width:primary?distance:hi-lo,height:primary?hi-lo:distance,fromId:b.node.id,toId:q.node.id};
    }
    if(best&&bands.length<100){const key=[best.x,best.y,best.width,best.height].join(',');if(!seen.has(key)){seen.add(key);bands.push(best);}}
   }
  }
  const result={bands,limited:all.length>200||bands.length>=100};layoutCache.set(id,result);return result;
 }
 return{measure,frame,layout,between};
}
const api={create,inverse,point,rect};if(typeof module==='object'&&module.exports)module.exports=api;else root.HandoffSpacing=api;
})(typeof window==='object'?window:globalThis);
