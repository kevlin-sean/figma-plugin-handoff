/* Lossless archive compaction. Hash buckets only accelerate exact byte comparisons. */
(function(root){
'use strict';
const R=typeof module==='object'&&module.exports?require('./resource-identity.js'):root.HandoffResource;
function identity(path,bytes){
 if(!path.toLowerCase().endsWith('.svg')||bytes.length>8*1024*1024)return bytes;
 try{return R.canonicalSvg(new TextDecoder('utf-8',{fatal:true}).decode(bytes))||bytes;}catch{return bytes;}
}
function signature(bytes){let h=2166136261;for(let i=0;i<bytes.length;i++)h=Math.imul(h^(typeof bytes==='string'?bytes.charCodeAt(i):bytes[i]),16777619);return bytes.length+':'+(h>>>0);}
function same(a,b){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
function stable(x){if(Array.isArray(x))return x.map(stable);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])]));return x;}
function assetKey(a){const x={...a};for(const k of ['id','path','nodeIds','uses','frameId','regionId'])delete x[k];return JSON.stringify(stable(x));}
function references(data){return new Set([...data.assets.map(a=>a.path),...data.previews.flatMap(p=>[p.path,...(p.patches||[]).map(q=>q.path)])]);}
function managed(path){return /^(assets|previews)\/r-[a-z0-9]+-[a-z0-9]+-[a-zA-Z0-9_-]+\.(png|svg|webp)$/.test(path);}
async function optimize(data,zip,prefix,{baseline=null,check=()=>{},progress=()=>{}}={}){
 const report={assetEntriesBefore:data.assets.length,assetEntriesAfter:0,resourceFilesBefore:0,resourceFilesAfter:0,reusedFiles:[],removedFiles:[],removedBytes:0,nameConflicts:[]};
 const prior=baseline?references(baseline):new Set();
 const paths=[...references(data)].sort((a,b)=>Number(!prior.has(a))-Number(!prior.has(b))),buckets=new Map(),aliases=new Map(),sizes=new Map();report.resourceFilesBefore=paths.length;
 for(let i=0;i<paths.length;i++){
  check();const path=paths[i],file=zip.file(prefix+path);if(!file)throw Error('打包缺少资源：'+path);
  progress(`去重资源 ${i+1}/${paths.length}`);
  const bytes=await file.async('uint8array'),content=identity(path,bytes),kind=typeof content==='string'?'svg-local-ids':'bytes',key=path.split('.').pop().toLowerCase()+':'+kind+':'+signature(content),bucket=buckets.get(key)||[];let canonical=null;
  sizes.set(path,bytes.length);
  for(const candidate of bucket){check();const other=identity(candidate,await zip.file(prefix+candidate).async('uint8array'));if(kind==='svg-local-ids'?content===other:same(bytes,other)){canonical=candidate;break;}}
  if(canonical){aliases.set(path,canonical);report.reusedFiles.push({from:path,to:canonical,bytes:bytes.length,comparison:kind});}
  else {bucket.push(path);buckets.set(key,bucket);}
 }

 for(const a of data.assets){a.path=aliases.get(a.path)||a.path;if(a.bytes!==undefined)a.bytes=sizes.get(a.path);}
 for(const p of data.previews){p.path=aliases.get(p.path)||p.path;for(const q of p.patches||[])q.path=aliases.get(q.path)||q.path;}
 function bindings(assets){const result=new Set();for(const a of assets){for(const id of a.nodeIds)result.add(JSON.stringify([a.path,assetKey(a),'node',id]));for(const u of a.uses||[])result.add(JSON.stringify([a.path,assetKey(a),'use',stable(u)]));}return result;}
 const expectedBindings=bindings(data.assets);
 const records=new Map(),assets=[];
 for(const a of data.assets){
  const key=a.path+'\n'+assetKey(a),existing=records.get(key);
  if(!existing){records.set(key,a);assets.push(a);continue;}
  existing.nodeIds=[...new Set([...existing.nodeIds,...a.nodeIds])];
  const uses=[...(existing.uses||[]),...(a.uses||[])],seen=new Set();
  existing.uses=uses.filter(u=>{const k=JSON.stringify(stable(u));if(seen.has(k))return false;seen.add(k);return true;});
 }
 const actualBindings=bindings(assets);
 if(expectedBindings.size!==actualBindings.size||[...expectedBindings].some(k=>!actualBindings.has(k)))throw Error('去重校验失败：图层或画板关联丢失。');
 data.assets=assets;report.assetEntriesAfter=assets.length;
 const names=new Map();for(const a of assets){const key=JSON.stringify([a.name,a.format]),group=names.get(key)||[];group.push(a);names.set(key,group);}
 for(const group of names.values())if(new Set(group.map(a=>a.path)).size>1)report.nameConflicts.push({name:group[0].name,format:group[0].format,variants:group.map(a=>({path:a.path,width:a.width,height:a.height,scale:a.scale,nodeIds:a.nodeIds}))});
 const used=references(data),known=new Set([...paths,...(baseline?references(baseline):[])]);
 for(const fullPath of Object.keys(zip.files)){
  check();if(!fullPath.startsWith(prefix)||zip.files[fullPath].dir)continue;const path=fullPath.slice(prefix.length);
  if(!/^(assets|previews)\//.test(path)||used.has(path)||(!known.has(path)&&!managed(path)))continue;
  const bytes=(await zip.file(fullPath).async('uint8array')).length;zip.remove(fullPath);report.removedFiles.push({path,bytes});report.removedBytes+=bytes;
 }
 // Verify every layer association survived and every reference resolves. This
 // is checked again before the ZIP is downloadable, not inferred from names.
 const shared=new Map();for(const a of assets){const g=shared.get(a.path)||{nodes:new Set(),frames:new Set()};for(const id of a.nodeIds)g.nodes.add(id);for(const u of a.uses||[])if(u.frameId)g.frames.add(u.frameId);if(a.frameId)g.frames.add(a.frameId);shared.set(a.path,g);}
 report.sharedAssets=[...shared].filter(([,g])=>g.nodes.size>1).map(([path,g])=>({path,nodeIds:[...g.nodes],frameIds:[...g.frames]}));
 for(const path of used)if(!zip.file(prefix+path))throw Error('去重校验失败，缺少资源：'+path);
 for(const [key,paths] of buckets)if(paths.length>1){
  // A hash collision is permitted only when the full content differs.
  for(let i=0;i<paths.length;i++)for(let j=0;j<i;j++){
   check();const a=identity(paths[i],await zip.file(prefix+paths[i]).async('uint8array')),b=identity(paths[j],await zip.file(prefix+paths[j]).async('uint8array'));
   if(typeof a==='string'?a===b:same(a,b))throw Error('去重校验失败，存在重复资源：'+key);
  }
 }
 report.resourceFilesAfter=used.size;report.validated=true;check();return report;
}
const api={optimize,references,managed};if(typeof module==='object'&&module.exports)module.exports=api;else root.HandoffOptimizer=api;
})(typeof window==='object'?window:globalThis);
