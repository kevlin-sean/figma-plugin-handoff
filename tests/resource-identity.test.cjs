const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {canonicalSvg}=require('../src/resource-identity.js'),O=require('../src/optimize-package.js'),JSZip=require('../vendor/jszip.min.js');
function svg(id='source',color='#f00') {return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><defs><linearGradient id="paint_${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="#00f"/></linearGradient><clipPath id="clip_${id}"><rect width="18" height="18" rx="4"/></clipPath></defs><g clip-path="url(#clip_${id})"><path id="shape_${id}" fill="url(#paint_${id})" d="M0 0H20V20H0Z"/></g></svg>`;}
function record(id,source,name='icon'){return {id,name,path:'assets/'+id+'.svg',format:'svg',width:20,height:20,scale:1,scaleLabel:'矢量',bytes:Buffer.byteLength(source),exportSettings:{format:'SVG'},nodeIds:[id],frameId:'frame-'+id,regionId:'region',uses:[{nodeId:id,name,frameId:'frame-'+id,regionId:'region',width:20,height:20}]};}
const simple=svg(),renamed=svg('another_frame_398_20865');
test('local SVG ID names normalize, but geometry, colors, opacity and reference topology remain significant',()=>{
 assert.ok(canonicalSvg(simple));assert.equal(canonicalSvg(simple),canonicalSvg(renamed));
 for(const changed of [svg('source','#0f0'),simple.replace('rx="4"','rx="8"'),simple.replace('fill="url(#paint_source)"','fill="url(#clip_source)"'),simple.replace('width="20"','width="40"'),simple.replace('<g clip-path','<g opacity="0.5" clip-path')])assert.notEqual(canonicalSvg(simple),canonicalSvg(changed));
});
test('href, xlink:href, local style URLs and forward references follow their actual target',()=>{
 const a='<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use href="#one"/><use xlink:href="#two"/><path style="fill:url(\'#one\');stroke:url(#two)"/><defs><g id="one"/><g id="two"/></defs></svg>',b=a.replaceAll('one','AAA').replaceAll('two','BBB');assert.ok(canonicalSvg(a));assert.equal(canonicalSvg(a),canonicalSvg(b));assert.notEqual(canonicalSvg(a),canonicalSvg(b.replace('href="#AAA"','href="#BBB"')));
 const color='<svg><path id="fff" fill="#fff"/></svg>';assert.equal(canonicalSvg(color),canonicalSvg(color.replace('id="fff"','id="renamed"')));assert.notEqual(canonicalSvg(color),canonicalSvg(color.replace('fill="#fff"','fill="#000"')));
});
const rejected=[
 '<svg><style>#a{fill:red}</style><path id="a"/></svg>',
 '<svg><script>something()</script></svg>',
 '<svg><animate attributeName="x" begin="one.click"/></svg>',
 '<!DOCTYPE svg [<!ENTITY x "foo">]><svg>&x;</svg>',
 '<svg><use href="other.svg#id"/></svg>',
 '<svg><use href="#missing"/></svg>',
 '<svg><path id="same"/><g id="same"/></svg>',
 '<svg><path fill="url(https://example.com/file.svg#a)"/></svg>',
 '<svg><path onclick="script()"/></svg>',
 '<svg><path id="a"/><path fill="url(\\23 a)"/></svg>',
 '<svg><path></svg>', '<svg><path id="a" id="b"/></svg>', '<svg>&unknown;</svg>',
 '<svg><![CDATA[hello]]></svg>', '<svg><foreignObject/></svg>', '<svg xmlns="unexpected"/>',
];
test('unsupported, external, malformed and dynamic SVGs fall back to exact bytes',()=>{for(const source of rejected)assert.equal(canonicalSvg(source),null,source);});
test('Python scope checker and JavaScript packager use identical canonical identities',()=>{
 const samples=[simple,renamed,svg('other','#0f0'),'<svg><title>中文 &amp; title</title><path id="a"/></svg>','<svg><g id="a"/><use href="#a"/></svg>',...rejected];
 const code="import sys,json; from resource_identity import canonical_svg; print(json.dumps([canonical_svg(x) for x in json.load(sys.stdin)],ensure_ascii=False))";
 const run=cp.spawnSync('python3',['-c',code],{cwd:path.join(__dirname,'../scripts'),input:JSON.stringify(samples),encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),samples.map(canonicalSvg));
});
test('three Frames referencing one component keep one SVG, preserve all bindings and report a validated shared resource',async()=>{
 const sources=[simple,renamed,svg('third')],data={assets:sources.map((s,i)=>record('icon'+i,s)),previews:[]},zip=new JSZip();data.assets.forEach((a,i)=>zip.file('test/'+a.path,sources[i]));
 const report=await O.optimize(data,zip,'test/');assert.equal(data.assets.length,1);assert.deepEqual(data.assets[0].nodeIds,['icon0','icon1','icon2']);assert.deepEqual(data.assets[0].uses.map(u=>u.frameId),['frame-icon0','frame-icon1','frame-icon2']);assert.equal(report.reusedFiles.length,2);assert.ok(report.reusedFiles.every(r=>r.comparison==='svg-local-ids'));assert.equal(report.validated,true);assert.equal(report.sharedAssets[0].frameIds.length,3);assert.equal(data.assets[0].bytes,Buffer.byteLength(simple));const bytes=await zip.generateAsync({type:'nodebuffer'}),loaded=await JSZip.loadAsync(bytes);assert.equal(Object.values(loaded.files).filter(f=>!f.dir).length,1);assert.equal(await loaded.file('test/'+data.assets[0].path).async('string'),simple);
});
test('changed component overrides remain distinct while renamed instances share a file and retain their names',async()=>{
 const sources=[simple,renamed,svg('override','#0f0')],data={assets:[record('a',sources[0],'one name'),record('b',sources[1],'another name'),record('c',sources[2],'one name')],previews:[]},zip=new JSZip();data.assets.forEach((a,i)=>zip.file('test/'+a.path,sources[i]));const report=await O.optimize(data,zip,'test/');assert.equal(data.assets.length,3);assert.equal(data.assets[0].path,data.assets[1].path);assert.notEqual(data.assets[0].path,data.assets[2].path);assert.equal(data.assets[1].name,'another name');assert.deepEqual(report.sharedAssets[0].nodeIds,['a','b']);assert.equal(report.nameConflicts.length,1);
});
test('same-looking SVGs using style selectors are retained independently rather than guessed equivalent',async()=>{
 const a='<svg><style>#a{fill:red}</style><path id="a"/></svg>',b=a.replaceAll('#a','#b').replace('id="a"','id="b"'),data={assets:[record('a',a),record('b',b)],previews:[]},zip=new JSZip();zip.file('test/assets/a.svg',a);zip.file('test/assets/b.svg',b);const r=await O.optimize(data,zip,'test/');assert.equal(r.reusedFiles.length,0);assert.equal(data.assets.length,2);
});
test('incremental scope checker accepts local-ID-only reuse, still rejects color changes and preserves the input ZIP',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-svg-'));try{
 const zip=new JSZip(),data={assets:[record('a',simple),record('b',renamed)],previews:[{id:'region',path:'previews/region.png'}]},design={title:'test',pages:[{id:'page',regions:['region']}],nodes:['a','b','region'].map(id=>({id,parentId:null,regionId:'region',frameId:'region',absoluteBoundingBox:{x:0,y:0,width:20,height:20}}))};zip.file('test/assets/a.svg',simple);zip.file('test/assets/b.svg',renamed);zip.file('test/previews/region.png','preview');for(const f of ['index.html','viewer.js','viewer.css','data/design-data.js'])zip.file('test/'+f,'unchanged');
 const write=()=>{for(const [name,value]of Object.entries({design,assets:data.assets,previews:data.previews}))zip.file('test/data/'+name+'.json',JSON.stringify(value));};write();const before=path.join(temp,'before.zip'),after=path.join(temp,'after.zip');fs.writeFileSync(before,await zip.generateAsync({type:'nodebuffer'}));await O.optimize(data,zip,'test/');write();fs.writeFileSync(after,await zip.generateAsync({type:'nodebuffer'}));
 const args=[path.join(__dirname,'../scripts/handoff_check.py'),'diff',before,after,'--scope','region','--allow-resource-compaction'];const good=cp.spawnSync('python3',args,{encoding:'utf8'});assert.equal(good.status,0,good.stdout+good.stderr);const original=await JSZip.loadAsync(fs.readFileSync(before));assert.equal(await original.file('test/assets/b.svg').async('string'),renamed);
 zip.file('test/assets/a.svg',simple.replace('#f00','#0f0'));fs.writeFileSync(after,await zip.generateAsync({type:'nodebuffer'}));const bad=cp.spawnSync('python3',args,{encoding:'utf8'});assert.equal(bad.status,1,bad.stdout);assert.equal(JSON.parse(bad.stdout).outside_asset_refs_changed,true);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
// Optional real SVG rasterizer used for visual-equivalence QA, never required by the plugin.
if(process.env.SHARP_PATH)test('independent SVG rasterizer produces identical pixels for reused gradients/clips and different pixels for overrides',async()=>{const sharp=require(process.env.SHARP_PATH),render=s=>sharp(Buffer.from(s)).resize(60,60).ensureAlpha().raw().toBuffer();assert.deepEqual(await render(simple),await render(renamed));assert.notDeepEqual(await render(simple),await render(svg('override','#0f0')));});

function shadowSvg(id){return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><defs><filter id="filter_${id}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur in="SourceAlpha" stdDeviation="1" result="blur_${id}"/><feOffset in="blur_${id}" dx="2" dy="2" result="effect1_dropShadow_${id}"/><feBlend in="SourceGraphic" in2="effect1_dropShadow_${id}" mode="normal" result="shape_${id}"/></filter></defs><rect x="3" y="3" width="12" height="12" fill="#f00" filter="url(#filter_${id})"/></svg>`;}
test('Figma filter result names and in/in2 references normalize within their own filter scope',()=>{const a=shadowSvg('123_40'),b=shadowSvg('398_20865');assert.ok(canonicalSvg(a));assert.equal(canonicalSvg(a),canonicalSvg(b));assert.notEqual(canonicalSvg(a),canonicalSvg(b.replace('in2="effect1_dropShadow_398_20865"','in2="blur_398_20865"')));assert.equal(canonicalSvg(a.replace('result="shape_123_40"','result="blur_123_40"')),null);const code='import sys,json; from resource_identity import canonical_svg; print(json.dumps([canonical_svg(x) for x in json.load(sys.stdin)],ensure_ascii=False))';const run=cp.spawnSync('python3',['-c',code],{cwd:path.join(__dirname,'../scripts'),input:JSON.stringify([a,b]),encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),[canonicalSvg(a),canonicalSvg(b)]);});
if(process.env.SHARP_PATH)test('independent rasterizer confirms shadow filter names can be shared without changing pixels',async()=>{const sharp=require(process.env.SHARP_PATH),render=s=>sharp(Buffer.from(s)).resize(60,60).ensureAlpha().raw().toBuffer();assert.deepEqual(await render(shadowSvg('123_40')),await render(shadowSvg('398_20865')));assert.notDeepEqual(await render(shadowSvg('123_40')),await render(shadowSvg('398_20865').replace('dx="2"','dx="4"')));});
