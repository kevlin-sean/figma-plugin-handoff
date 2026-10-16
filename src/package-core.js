/* Pure archive/data operations: shared by the plugin UI and Node tests. */
(function(root){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function fail(message){throw Error(message);}
function safePath(path){if(typeof path!=='string'||!path||path.includes('\\')||path.startsWith('/')||path.split('/').some(p=>p==='..'||p==='.')||/^[a-z]+:/i.test(path))fail('包内路径无效：'+path);return path;}
function subtree(nodes,id){const result=new Set([id]);let changed=true;while(changed){changed=false;for(const n of nodes)if(result.has(n.parentId)&&!result.has(n.id)){result.add(n.id);changed=true;}}return result;}
function validate(design,assets,previews){
 if(!design||!Array.isArray(design.nodes)||!design.nodes.length||!Array.isArray(design.pages)||!design.pages.length)fail('交付包缺少页面或图层数据');
 if(!Array.isArray(assets)||!Array.isArray(previews))fail('交付包缺少切图或预览索引');
 const ids=new Set();for(const n of design.nodes){if(!n.id||ids.has(n.id))fail('重复或无效的图层 ID');ids.add(n.id);const b=n.absoluteBoundingBox;if(!b||![b.x,b.y,b.width,b.height,n.width,n.height].every(Number.isFinite))fail('图层坐标无效：'+n.id);}
 for(const n of design.nodes)for(const k of ['parentId','regionId','frameId'])if(n[k]&&!ids.has(n[k]))fail('图层引用缺失：'+n.id+' / '+k);
 const nodeMap=new Map(design.nodes.map(n=>[n.id,n]));for(const n of design.nodes){if(n.parentId&&!(nodeMap.get(n.parentId).depth<n.depth))fail('图层层级无效：'+n.id);if(n.depth===0&&n.parentId)fail('根图层不能有父级');}
 for(const p of design.pages){if(!Array.isArray(p.regions)||!p.regions.length)fail('页面没有导出区域');for(const id of p.regions)if(!ids.has(id)||!previews.some(v=>v.id===id))fail('页面预览缺失：'+id);}
 for(const p of previews){safePath(p.path);if(!ids.has(p.id))fail('预览图层不存在');for(const q of p.patches||[])safePath(q.path);}
 for(const a of assets){safePath(a.path);if(!Array.isArray(a.nodeIds)||!a.nodeIds.length||a.nodeIds.some(id=>!ids.has(id)))fail('切图图层引用缺失：'+a.path);}
 return {pages:design.pages.length,regions:previews.length,nodes:design.nodes.length,assets:assets.length};
}
function almost(a,b){return Math.abs(a-b)<0.01;}
function opaqueRect(n){
 const fills=Array.isArray(n.fills)?n.fills.filter(p=>p.visible!==false):[];
 return n.type==='FRAME'&&n.clipsContent===true&&(n.opacity??1)===1&&(!n.blendMode||['NORMAL','PASS_THROUGH'].includes(n.blendMode))&&
 !n.rotation&&['cornerRadius','topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius'].every(k=>!n[k])&&
 !(n.effects||[]).some(e=>e.visible!==false)&&
 fills.some(p=>p.type==='SOLID'&&(p.opacity??1)===1)&&
 (n.absoluteTransform?almost(n.absoluteTransform[0][0],1)&&almost(n.absoluteTransform[0][1],0)&&almost(n.absoluteTransform[1][0],0)&&almost(n.absoluteTransform[1][1],1):true);
}
function intersects(a,b){return a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;}
function contains(a,b){return b.x>=a.x-.01&&b.y>=a.y-.01&&b.x+b.width<=a.x+a.width+.01&&b.y+b.height<=a.y+a.height+.01;}
function translate(n,dx,dy){for(const key of ['absoluteBoundingBox','absoluteRenderBounds'])if(n[key]){n[key].x+=dx;n[key].y+=dy;}if(n.absoluteTransform){n.absoluteTransform[0][2]+=dx;n.absoluteTransform[1][2]+=dy;}}
function merge(baseline,incoming,selectedIds){
 validate(baseline.design,baseline.assets,baseline.previews);validate(incoming.design,incoming.assets,incoming.previews);
 if(baseline.design.fileKey&&incoming.design.fileKey&&baseline.design.fileKey!==incoming.design.fileKey)fail('旧交付包不属于当前 Figma 文件');
 const result=clone({design:baseline.design,assets:baseline.assets,previews:baseline.previews}),oldMap=new Map(baseline.design.nodes.map(n=>[n.id,n])),newMap=new Map(incoming.design.nodes.map(n=>[n.id,n]));
 if(!selectedIds.length||new Set(selectedIds).size!==selectedIds.length)fail('没有有效更新目标');
 const removed=new Set(),changes=[];const maps=[];
 for(const id of selectedIds){
  const old=oldMap.get(id),fresh=newMap.get(id);if(!old||!fresh)fail('旧包中找不到同 ID 画板：'+id+'。请选中原画板；重建后的新 ID 需要重新导出。');
  if(!['FRAME','SECTION','COMPONENT','INSTANCE','COMPONENT_SET'].includes(old.type)||old.type!==fresh.type)fail('画板类型变化，请重新导出该区域');
  const ids=subtree(baseline.design.nodes,id);if([...ids].some(x=>removed.has(x)))fail('更新目标不能互相包含');for(const x of ids)removed.add(x);
  const newIds=subtree(incoming.design.nodes,id),dx=old.absoluteBoundingBox.x-fresh.absoluteBoundingBox.x,dy=old.absoluteBoundingBox.y-fresh.absoluteBoundingBox.y;
  maps.push({id,old,fresh,ids,newIds,dx,dy});changes.push({id,name:old.name,oldNodes:ids.size,newNodes:newIds.size,preservePosition:true});
 }
 for(const m of maps){
  for(const id of m.newIds)if(oldMap.has(id)&&!removed.has(id))fail('新子图层 ID 与未更新区域冲突：'+id);
  const image=clone(incoming.previews.find(p=>p.id===m.id));if(!image)fail('更新画板缺少预览');
  if(m.old.depth===0){const at=result.previews.findIndex(p=>p.id===m.id);if(at<0)fail('旧预览缺失');result.previews[at]=image;}
  else {
   // Safe rectangular overlay only. Transparent/rounded/masked composition must be updated at the region boundary.
   if(!opaqueRect(m.old)||!opaqueRect(m.fresh)||!almost(m.old.width,m.fresh.width)||!almost(m.old.height,m.fresh.height))fail('嵌套画板更新需要同尺寸、不透明、无圆角/阴影且开启裁剪的 Frame。请选择最外层交付区域后更新。');
   const region=oldMap.get(m.old.regionId),rb=region.absoluteBoundingBox,b=m.old.absoluteBoundingBox;
   const patch={nodeId:m.id,frameId:m.id,path:image.path,x:b.x-rb.x,y:b.y-rb.y,width:b.width,height:b.height,background:'transparent'};
   if(!contains({x:0,y:0,width:rb.width,height:rb.height},patch))fail('画板超出旧区域范围，请更新最外层区域');
   // A later overlapping sibling would be painted over by an overlay; reject instead of changing unrelated pixels.
   let branch=m.old;
   while(branch&&branch.id!==region.id){const index=baseline.design.nodes.findIndex(n=>n.id===branch.id);const later=baseline.design.nodes.filter((n,i)=>i>index&&n.parentId===branch.parentId&&n.visible!==false&&!removed.has(n.id));if(later.some(n=>intersects(n.absoluteRenderBounds||n.absoluteBoundingBox,b)))fail('画板与上层兄弟图层重叠，请更新最外层区域');const parent=oldMap.get(branch.parentId);if(parent&&(parent.isMask||(parent.opacity??1)!==1||(parent.effects||[]).some(e=>e.visible!==false)||(parent.blendMode&&!['NORMAL','PASS_THROUGH'].includes(parent.blendMode))))fail('父级合成效果不适合局部覆盖，请更新最外层区域');if(parent?.clipsContent&&!contains(parent.absoluteBoundingBox,b))fail('画板被父级裁剪，请更新最外层区域');branch=parent;}
   const p=result.previews.find(p=>p.id===region.id);if(!p)fail('旧区域预览缺失');
   p.patches=(p.patches||[]).filter(q=>{if(!intersects(patch,q))return true;if(contains(patch,q))return false;fail('与已有局部补丁交叉，请更新最外层区域');});p.patches.push(patch);
  }
 }
 const replacements=new Map();
 for(const m of maps){
  const block=incoming.design.nodes.filter(n=>m.newIds.has(n.id)).map(n=>{
   const x=clone(n);translate(x,m.dx,m.dy);x.depth=m.old.depth+n.depth;x.regionId=m.old.regionId;
   if(m.old.pageId)x.pageId=m.old.pageId;else delete x.pageId;
   if(m.old.depth>0)x.frameId=m.old.frameId;
   if(x.id===m.id){x.parentId=m.old.parentId;x.x=m.old.x;x.y=m.old.y;}
   return x;
  });replacements.set(m.id,block);
 }
 result.design.nodes=baseline.design.nodes.flatMap(n=>replacements.get(n.id)||(removed.has(n.id)?[]:[clone(n)]));
 result.assets=baseline.assets.flatMap(a=>{const kept=a.nodeIds.filter(id=>!removed.has(id));if(!kept.length)return [];if(kept.length===a.nodeIds.length)return [clone(a)];const x=clone(a);x.nodeIds=kept;x.uses=(x.uses||[]).filter(u=>!removed.has(u.nodeId));const owner=oldMap.get(kept[0]);x.frameId=owner.frameId;x.regionId=owner.regionId;return [x];});
 for(const a of incoming.assets){const owner=maps.find(m=>a.nodeIds.some(id=>m.newIds.has(id)));if(!owner)continue;const x=clone(a);x.regionId=owner.old.regionId;if(owner.old.depth>0)x.frameId=owner.old.frameId;for(const u of x.uses||[]){u.regionId=owner.old.regionId;if(owner.old.depth>0)u.frameId=owner.old.frameId;}result.assets.push(x);}
 if(result.design.navigation){const nav=incoming.design.navigation||selectedIds;result.design.navigation=result.design.navigation.flatMap(id=>{const m=maps.find(m=>m.ids.has(id));if(!m)return [id];if(m.id!==id&&result.design.navigation.includes(m.id))return [];return nav.filter(n=>m.newIds.has(n));});result.design.navigation=[...new Set(result.design.navigation)];}
 result.design.exportedAt=incoming.design.exportedAt;
 result.changes=changes;
 validate(result.design,result.assets,result.previews);
 const finalMap=new Map(result.design.nodes.map(n=>[n.id,n]));for(const n of baseline.design.nodes)if(!removed.has(n.id)&&JSON.stringify(n)!==JSON.stringify(finalMap.get(n.id)))fail('未选中图层发生意外变化：'+n.id);
 return result;
}
const api={clone,safePath,subtree,validate,merge,opaqueRect};
if(typeof module==='object'&&module.exports)module.exports=api;else root.HandoffCore=api;
})(typeof window==='object'?window:globalThis);
