const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../dist/core/preview-optimize.cjs'),O=require('../dist/core/optimize-package.cjs'),JSZip=require('jszip');
function chunk(tag,data=Buffer.alloc(0)){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(tag,4);data.copy(b,8);return b;}
function png(extra=[],width=2880,height=1800,depth=8){const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=depth;h[9]=6;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),...extra,chunk('IEND')]);}
test('preview eligibility protects profiles, animation, precision and bounded working memory',()=>{
 assert.deepEqual(P.pngInfo(png()),{width:2880,height:1800});
 for(const tag of ['iCCP','cICP','acTL'])assert.equal(P.pngInfo(png([chunk(tag)])),null);
 const gamma=Buffer.alloc(4);gamma.writeUInt32BE(100000);assert.equal(P.pngInfo(png([chunk('gAMA',gamma)])),null);
 assert.equal(P.pngInfo(png([],9000,9000)),null);assert.equal(P.pngInfo(png([],10,10,16)),null);assert.equal(P.pngInfo(png().subarray(0,25)),null);
 assert.equal(P.equalPixels(Uint8Array.of(1,2),Uint8Array.of(1,3)),false);
});
test('only newly supplied previews are replaced, with a single resource and unchanged layout metadata',async()=>{
 const a=Uint8Array.from({length:5000},()=>7),asset=Uint8Array.from({length:5000},()=>9),files=new Map([['previews/new.png',a],['assets/icon.png',asset]]),previews=[{id:'new',path:'previews/new.png',scale:2,pixelWidth:2880,pixelHeight:1800,offsetX:-10,displayWidth:1440},{id:'old',path:'previews/old.png',scale:1}],before=structuredClone(previews);
 await P.optimize(files,previews,{compress:async()=>new Uint8Array(1000)});
 assert.equal(previews[0].path,'previews/new.webp');assert.equal(files.has('previews/new.png'),false);assert.equal(files.size,2);assert.deepEqual(files.get('assets/icon.png'),asset);assert.deepEqual({...previews[0],path:before[0].path},before[0]);assert.deepEqual(previews[1],before[1]);
});
test('failed or larger compression keeps PNG bytes; cancellation remains fatal',async()=>{
 const bytes=new Uint8Array(5000);for(const compress of [async()=>new Uint8Array(6000),async()=>{throw Error('codec blocked')}]){const files=new Map([['previews/a.png',bytes]]),p=[{path:'previews/a.png'}];await P.optimize(files,p,{compress});assert.equal(p[0].path,'previews/a.png');assert.equal(files.get(p[0].path),bytes);}
 const files=new Map([['previews/a.png',bytes]]);let cancelled=false;await assert.rejects(()=>P.optimize(files,[{path:'previews/a.png'}],{check(){if(cancelled)throw Error('cancel')},compress:async()=>{cancelled=true;throw Error('worker stopped')}}),/cancel/);assert.equal(files.get('previews/a.png'),bytes);
});
test('partial compaction prunes only known or generated WebP previews and retains custom files',async()=>{
 const data={assets:[],previews:[{id:'f',path:'previews/new.webp'}]},zip=new JSZip();zip.file('p/previews/new.webp','new');zip.file('p/previews/old.webp','old');zip.file('p/previews/r-old-run-unused.webp','unused');zip.file('p/previews/custom.webp','custom');
 await O.optimize(data,zip,'p/',{baseline:{assets:[],previews:[{id:'f',path:'previews/old.webp'}]}});
 assert.equal(zip.file('p/previews/old.webp'),null);assert.equal(zip.file('p/previews/r-old-run-unused.webp'),null);assert.ok(zip.file('p/previews/custom.webp'));assert.ok(zip.file('p/previews/new.webp'));
});

test('a smaller raw candidate is retained as PNG when its real compressed ZIP entry is larger',async()=>{
 const bytes=new Uint8Array(5000),files=new Map([['previews/a.png',bytes]]),previews=[{path:'previews/a.png'}];let x=7;const noisy=Uint8Array.from({length:1000},()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x>>>24;});
 async function archiveSize(data){const z=new JSZip();z.file('preview',data);return(await z.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:9}})).length;}
 await P.optimize(files,previews,{compress:async()=>noisy,archiveSize});assert.equal(previews[0].path,'previews/a.png');assert.equal(files.get(previews[0].path),bytes);
});


test('previews already shared with cutouts or retained PNG resources do not create a second format',async()=>{
 const bytes=new Uint8Array(5000),files=new Map([['previews/a.png',bytes],['assets/a.png',bytes.slice()]]),p=[{path:'previews/a.png'}];let calls=0;
 await P.optimize(files,p,{compress:async()=>{calls++;return new Uint8Array(100)}});assert.equal(calls,0);assert.equal(p[0].path,'previews/a.png');
 const current=new Map([['previews/new.png',bytes]]),q=[{path:'previews/new.png'}];await P.optimize(current,q,{compress:async()=>{calls++;return new Uint8Array(100)},isShared:async input=>P.equalPixels(input,bytes)});assert.equal(calls,0);assert.equal(q[0].path,'previews/new.png');
});
