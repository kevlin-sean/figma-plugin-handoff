/* Both halves run together. Figma-to-UI messages deliberately have source:null. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const C=require('../src/package-core.js'),JSZip=require('../vendor/jszip.min.js');
const root=path.resolve(__dirname,'..');
class Element{constructor(){this.children=[];this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.textContent='';this.classList={toggle(){}};}append(...els){this.children.push(...els);}replaceChildren(){this.children=[];}removeAttribute(name){delete this[name];}}
function page(id){return{id,name:id,type:'PAGE',children:[],selection:[],loadAsync:async()=>{}};}
function frame(id,p,type='FRAME'){const n={id,name:'Design '+id,type,parent:p,children:[],visible:true,width:160,height:240,x:10,y:20,absoluteBoundingBox:{x:10,y:20,width:160,height:240},absoluteTransform:[[1,0,10],[0,1,20]],exportSettings:[],fills:[],clipsContent:true};p.children.push(n);n.exportAsync=async settings=>{const b=new Uint8Array(24),v=new DataView(b.buffer);v.setUint32(0,0x89504e47);v.setUint32(16,Math.round(n.width*(settings.constraint?.type==='WIDTH'?settings.constraint.value/n.width:settings.constraint?.type==='HEIGHT'?settings.constraint.value/n.height:settings.constraint?.value||1)));v.setUint32(20,Math.round(n.height*(settings.constraint?.type==='WIDTH'?settings.constraint.value/n.width:settings.constraint?.type==='HEIGHT'?settings.constraint.value/n.height:settings.constraint?.value||1)));return b;};return n;}
function harness({initialSelection=false,disconnect=false,nativeSource=null,uiSource=null}={}){
 const p1=page('p1'),p2=page('p2'),a=frame('a',p1),b=frame('b',p1,'SECTION'),c=frame('c',p2),events={},sent=[],outgoing=[],tasks=[];let channel,ui,blob;
 if(initialSelection)p1.selection=[a];
 const native={figma:{base64Encode:a=>Buffer.from(a).toString('base64'),root:{name:'Fixture',children:[p1,p2]},currentPage:p1,fileKey:'fixture',on(name,fn){events[name]=fn},showUI(html){channel=html},ui:{postMessage(message){outgoing.push(message);if(ui&&!disconnect)tasks.push(ui.window.onmessage({source:null,data:{pluginMessage:message}}));}}},__html__:'__HANDOFF_CHANNEL__',console,Uint8Array,DataView};
 vm.createContext(native);vm.runInContext(nativeSource||fs.readFileSync(path.join(root,'code.js'),'utf8'),native);
 const els=new Map(),$=id=>{if(!els.has(id))els.set(id,new Element());return els.get(id)},choice={mode:{value:'new'},scope:{value:'selection'}};
 $('previewScale').value='1';
 const pageInputs=()=>$('pages').children.map(label=>label.children[0]);
 const document={getElementById:$,querySelector(s){return s.includes('name=mode')?choice.mode:choice.scope;},querySelectorAll(s){if(s==='#pages input:checked')return pageInputs().filter(e=>e.checked);if(s==='input,select')return [...els.values(),...pageInputs()];return[];},createElement(){return new Element()},createTextNode(text){return{textContent:text}}};
 const timers=new Map();let nextTimer=0;
 ui={document,parent:{postMessage({pluginMessage}){sent.push(pluginMessage);tasks.push(native.figma.ui.onmessage(pluginMessage));}},window:{addEventListener(){}},HandoffCore:C,HandoffOptimizer:require('../src/optimize-package.js'),JSZip,VIEWER:Object.fromEntries(fs.readdirSync(path.join(root,'viewer')).map(n=>[n,fs.readFileSync(path.join(root,'viewer',n),'utf8')])),console,Uint8Array,Blob,URL:{createObjectURL(value){blob=value;return'blob:result'},revokeObjectURL(){}},setTimeout(fn){timers.set(++nextTimer,fn);return nextTimer},clearTimeout(id){timers.delete(id)}};
 vm.createContext(ui);vm.runInContext((uiSource||fs.readFileSync(path.join(root,'src/ui.js'),'utf8')).replaceAll('__HANDOFF_CHANNEL__',channel),ui);
 async function drain(){while(tasks.length){const pending=tasks.splice(0);await Promise.all(pending);}}
 return{native,ui,$,p1,p2,a,b,c,sent,outgoing,choice,events,pageInputs,timers,channel,drain,blob:()=>blob};
}
test('startup selection reaches UI despite a null MessageEvent.source',async()=>{const h=harness({initialSelection:true});await h.drain();assert.match(h.$('selection').textContent,/Design a/);assert.match(h.$('connection').textContent,/已连接 Figma/);assert.equal(h.pageInputs().length,2);assert.equal(h.timers.size,0);});
test('a dropped selectionchange event cannot block exporting the current Frame; ZIP is generated',async()=>{const h=harness();await h.drain();assert.match(h.$('selection').textContent,/无/);h.p1.selection=[h.a];await h.$('export').onclick();await h.drain();assert.equal(h.$('download').hidden,false,h.$('status').textContent);assert.ok(h.sent.some(m=>m.type==='get-state'));const zip=await JSZip.loadAsync(await h.blob().arrayBuffer()),file=Object.keys(zip.files).find(n=>n.endsWith('data/design.json')),design=JSON.parse(await zip.file(file).async('string'));assert.deepEqual(design.pages[0].regions,['a']);assert.equal(design.nodes[0].id,'a');assert.equal(h.timers.size,0);});
test('selecting a Section after plugin startup exports the Section',async()=>{const h=harness();await h.drain();h.p1.selection=[h.b];h.events.selectionchange();await h.drain();assert.match(h.$('selection').textContent,/Design b/);await h.$('export').onclick();await h.drain();const done=h.outgoing.find(m=>m.type==='complete');assert.ok(done,h.$('status').textContent);assert.deepEqual(Array.from(done.selectedRootIds),['b']);assert.equal(done.design.nodes[0].type,'SECTION');});
test('switching Page refreshes selection and keeps manually chosen Page checkboxes',async()=>{const h=harness();await h.drain();h.pageInputs()[0].checked=false;h.pageInputs()[1].checked=true;h.p2.selection=[h.c];h.native.figma.currentPage=h.p2;h.events.currentpagechange();await h.drain();assert.match(h.$('selection').textContent,/Design c/);assert.deepEqual(h.pageInputs().map(n=>n.checked),[false,true]);await h.$('export').onclick();await h.drain();assert.deepEqual(Array.from(h.outgoing.find(m=>m.type==='complete').selectedRootIds),['c']);});
test('stale nonempty UI selection is not used after the real selection is cleared',async()=>{const h=harness({initialSelection:true});await h.drain();h.p1.selection=[];await h.$('export').onclick();await h.drain();assert.match(h.$('status').textContent,/请先在 Figma 中选中/);assert.ok(!h.blob());assert.equal(h.$('export').disabled,false);});
test('refresh selection button actively reads host state and rejects foreign channel packets',async()=>{const h=harness();await h.drain();h.p1.selection=[h.b];await h.$('refreshSelection').onclick();await h.drain();assert.match(h.$('selection').textContent,/Design b/);await h.ui.window.onmessage({source:null,data:{pluginMessage:{channel:'foreign',type:'catalog',pages:[],selection:[]}}});assert.match(h.$('selection').textContent,/Design b/);const before=h.outgoing.length;await h.native.figma.ui.onmessage({type:'get-state',channel:'foreign'});assert.equal(h.outgoing.length,before);});
test('a disconnected bridge shows a connection error instead of falsely claiming there is no selection',async()=>{const h=harness({disconnect:true});const click=h.$('export').onclick();for(const fn of [...h.timers.values()])fn();await click;await h.drain();assert.match(h.$('status').textContent,/无法同步 Figma 选区/);assert.equal(h.$('export').disabled,false);assert.ok(!h.sent.some(m=>m.type==='export'));});
test('invalid leaf selection is rejected by Figma-side validation, without implicit scope expansion',async()=>{const h=harness();await h.drain();const text=frame('text',h.p1,'TEXT');h.p1.selection=[text];await h.$('export').onclick();await h.drain();assert.match(h.$('status').textContent,/而不是按钮或文字/);assert.ok(!h.outgoing.some(m=>m.type==='complete'));});

if(process.env.OLD_PLUGIN_FIXTURE)test('v1.1 reproduces the reported false empty-selection error for relayed messages',async()=>{
 const zip=await JSZip.loadAsync(fs.readFileSync(process.env.OLD_PLUGIN_FIXTURE));const main=Object.keys(zip.files).find(p=>p.endsWith('/code.js')),prefix=main.slice(0,-7);
 const h=harness({initialSelection:true,nativeSource:await zip.file(main).async('string'),uiSource:await zip.file(prefix+'src/ui.js').async('string')});
 await h.drain();await h.$('export').onclick();await h.drain();assert.match(h.$('status').textContent,/请在 Figma 中选中 Frame \/ Section/);assert.ok(!h.sent.some(m=>m.type==='export'));
});
test('partial updates validate the actual selection against the old package before rendering',async()=>{const h=harness({initialSelection:true});await h.drain();vm.runInContext("baseline={design:{nodes:[{id:'other-frame'}]}}",h.ui);h.choice.mode.value='update';h.$('sameFile').checked=true;await h.$('export').onclick();await h.drain();assert.match(h.$('status').textContent,/不在旧交付包/);assert.ok(!h.outgoing.some(m=>m.type==='file'||m.type==='complete'));});

test('populated Section reaches UI through the bridge and ZIP contains its self-contained composite preview',async()=>{const h=harness();await h.drain();h.p1.selection=[h.b];h.b.exportAsync=async()=>{throw Error('unsupported Section bounds')};const a=frame('inside-section',h.b);await h.$('export').onclick();await h.drain();assert.equal(h.$('download').hidden,false,h.$('status').textContent);const zip=await JSZip.loadAsync(await h.blob().arrayBuffer());const name=Object.keys(zip.files).find(n=>n.endsWith('data/previews.json')),prefix=name.slice(0,-'data/previews.json'.length),previews=JSON.parse(await zip.file(name).async('string'));assert.equal(previews[0].tiles[0].nodeId,a.id);const svg=await zip.file(prefix+previews[0].path).async('string');assert.match(svg,/data:image\/png;base64,/);assert.match(svg,/viewBox="0 0 160 240"/);});

test('asset errors cross the bridge without aborting ZIP, identify frame and layer, and retain successful formats',async()=>{
 const h=harness({initialSelection:true});await h.drain();const n=frame('398:20865',h.a,'RECTANGLE'),other=frame('next',h.a,'RECTANGLE');n.name='矩形';n.exportSettings=[{format:'SVG'},{format:'PNG'}];other.exportSettings=[{format:'PNG'}];const exporter=n.exportAsync;n.exportAsync=async setting=>{if(setting.format==='SVG')throw Error('Failed to export node. This node may not have any visible layers.');return exporter(setting)};
 await h.$('export').onclick();await h.drain();assert.equal(h.$('download').hidden,false,h.$('status').textContent);assert.match(h.$('status').textContent,/切图失败 1 项/);assert.doesNotMatch(h.$('status').textContent,/图层路径|Failed to export/);assert.equal(h.$('failureDetails').hidden,false);assert.equal(h.$('failureDetails').open,false);assert.match(h.$('failureList').textContent,/画板：Design a（a）/);assert.match(h.$('failureList').textContent,/矩形（398:20865）/);assert.match(h.$('failureList').textContent,/SVG/);assert.match(h.$('failureList').textContent,/可见性、透明度、裁剪和蒙版/);
 const zip=await JSZip.loadAsync(await h.blob().arrayBuffer()),name=Object.keys(zip.files).find(p=>p.endsWith('data/update-report.json')),prefix=name.slice(0,-'data/update-report.json'.length),report=JSON.parse(await zip.file(name).async('string'));
 assert.equal(Object.hasOwn(report,'assetFailures'),false);assert.equal(Object.hasOwn(report,'warnings'),false);assert.equal(Object.hasOwn(report,'status'),false);assert.equal(zip.file(prefix+'切图失败清单.txt'),null);for(const file of Object.values(zip.files))if(!file.dir&&/\.(json|js|txt|html)$/.test(file.name))assert.doesNotMatch(await file.async('string'),/may not have any visible layers/);const assets=JSON.parse(await zip.file(prefix+'data/assets.json').async('string'));assert.equal(assets.length,2);for(const asset of assets){assert.ok(zip.file(prefix+asset.path));assert.equal(asset.format,'png');}
});
test('failed configured parent does not suppress explicitly configured descendant assets',async()=>{
 const h=harness({initialSelection:true});await h.drain();const parent=frame('parent-cutout',h.a);parent.exportSettings=[{format:'SVG'}];parent.exportAsync=async()=>{throw Error('parent export failed')};const child=frame('child-cutout',parent,'VECTOR');child.width=20;child.height=20;child.absoluteBoundingBox.width=20;child.absoluteBoundingBox.height=20;child.exportSettings=[{format:'SVG'},{format:'PNG'}];const childPNG=child.exportAsync;child.exportAsync=async setting=>setting.format==='SVG'?new TextEncoder().encode('<svg/>'):childPNG(setting);
 await h.$('export').onclick();await h.drain();const done=h.outgoing.find(m=>m.type==='complete');assert.ok(done,h.$('status').textContent);assert.equal(done.assetFailures.length,1);assert.equal(done.assets.length,2);assert.ok(done.assets.every(a=>a.nodeIds[0]==='child-cutout'));
});

test('first PNG Export controls scale with one output per format, independently of preview scale',async()=>{
 for(const scale of [1,2,3,1.5]){
  const h=harness({initialSelection:true});await h.drain();h.$('previewScale').value='2';
  const n=frame('multi-size',h.a,'RECTANGLE');n.exportSettings=[{format:'PNG',suffix:'@chosen',constraint:{type:'SCALE',value:scale},useAbsoluteBounds:true},{format:'PNG',suffix:'@2x',constraint:{type:'SCALE',value:2}},{format:'PNG',constraint:{type:'WIDTH',value:1000}},{format:'SVG',suffix:'one'},{format:'SVG',suffix:'two'}];
  const before=JSON.stringify(n.exportSettings),calls=[],exporter=n.exportAsync;n.exportAsync=async setting=>{calls.push(setting);return setting.format==='SVG'?new TextEncoder().encode('<svg/>'):exporter(setting)};
  await h.$('export').onclick();await h.drain();const done=h.outgoing.find(m=>m.type==='complete');assert.ok(done,h.$('status').textContent);assert.equal(calls.length,2);assert.equal(calls.filter(c=>c.format==='PNG').length,1);assert.equal(calls.filter(c=>c.format==='SVG').length,1);assert.equal(calls[0].constraint.type,'SCALE');assert.equal(calls[0].constraint.value,scale);assert.equal(calls[0].suffix,'@chosen');assert.equal(calls[0].useAbsoluteBounds,true);assert.equal(JSON.stringify(n.exportSettings),before);
  assert.equal(done.previews[0].scale,2);const png=done.assets.find(a=>a.format==='png');assert.equal(png.scale,scale);assert.equal(png.scaleLabel,scale+'×');assert.equal(png.pixelWidth,160*scale);assert.equal(png.pixelHeight,240*scale);
  const options=h.sent.find(m=>m.type==='export').options;assert.equal(Object.hasOwn(options,'pngScale'),false);
  const zip=await JSZip.loadAsync(await h.blob().arrayBuffer()),name=Object.keys(zip.files).find(p=>p.endsWith('data/assets.json')),assets=JSON.parse(await zip.file(name).async('string'));assert.equal(assets.length,2);assert.equal(assets.find(a=>a.format==='png').scale,scale);assert.equal(Object.values(zip.files).filter(f=>!f.dir&&/\/assets\/.+\.png$/.test(f.name)).length,1);
 }
});
test('fixed-width and fixed-height PNG Export constraints retain their configured dimensions',async()=>{
 for(const type of ['WIDTH','HEIGHT']){const h=harness({initialSelection:true});await h.drain();const n=frame('fixed-size',h.a,'RECTANGLE');n.exportSettings=[{format:'PNG',constraint:{type,value:480}}];const before=JSON.stringify(n.exportSettings);await h.$('export').onclick();await h.drain();const done=h.outgoing.find(m=>m.type==='complete');assert.ok(done,h.$('status').textContent);const asset=done.assets[0];assert.equal(done.assets.length,1);assert.equal(asset.exportSettings.constraint.type,type);assert.equal(asset.exportSettings.constraint.value,480);assert.equal(asset.pixelWidth,type==='WIDTH'?480:320);assert.equal(asset.pixelHeight,type==='WIDTH'?720:480);assert.equal(asset.scale,type==='WIDTH'?3:2);assert.equal(JSON.stringify(n.exportSettings),before);}
});
test('PNG-only exports default to 1x and obsolete pngScale options cannot override saved Export settings',async()=>{
 const h=harness({initialSelection:true});await h.drain();const n=frame('icon',h.a,'VECTOR');n.width=20;n.height=20;n.exportSettings=[{format:'PNG'}];await h.$('export').onclick();await h.drain();const done=h.outgoing.find(m=>m.type==='complete');assert.ok(done,h.$('status').textContent);assert.equal(done.assets.length,1);assert.equal(done.assets[0].format,'png');assert.equal(done.assets[0].scale,1);assert.equal(done.assets[0].pixelWidth,20);
 const legacy=harness({initialSelection:true});await legacy.drain();const icon=frame('legacy-scale',legacy.a,'VECTOR');icon.exportSettings=[{format:'PNG',constraint:{type:'SCALE',value:2}}];await legacy.native.figma.ui.onmessage({type:'export',channel:legacy.channel,runId:'legacy',options:{mode:'new',scope:'selection',previewScale:1,pngScale:4}});await legacy.drain();const result=legacy.outgoing.find(m=>m.type==='complete');assert.ok(result);assert.equal(result.assets[0].scale,2);
});

test('same explicitly exported component on three Frames shares PNG/SVG',async()=>{
 const h=harness();await h.drain();h.p1.selection=[h.b];const ids=[];
 for(let i=0;i<3;i++){
  const board=frame('board-'+i,h.b),icon=frame('same-component-'+i,board,'INSTANCE');icon.name='共同图标';icon.width=20;icon.height=20;icon.absoluteBoundingBox.width=20;icon.absoluteBoundingBox.height=20;icon.exportSettings=[{format:'SVG'},{format:'PNG',constraint:{type:'SCALE',value:3}}];ids.push(icon.id);const png=icon.exportAsync;
  icon.exportAsync=async setting=>setting.format==='SVG'?new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><defs><clipPath id="clip_${i}_398"><rect width="20" height="20"/></clipPath></defs><path fill="#ff6600" clip-path="url(#clip_${i}_398)" d="M0 0H20V20H0Z"/></svg>`):png(setting);
 }
 await h.$('export').onclick();await h.drain();assert.equal(h.$('download').hidden,false,h.$('status').textContent);
 const zip=await JSZip.loadAsync(await h.blob().arrayBuffer()),name=Object.keys(zip.files).find(p=>p.endsWith('data/assets.json')),prefix=name.slice(0,-'data/assets.json'.length),assets=JSON.parse(await zip.file(name).async('string')),report=JSON.parse(await zip.file(prefix+'data/update-report.json').async('string'));
 assert.equal(assets.length,2);for(const asset of assets){assert.deepEqual(asset.nodeIds,ids);assert.deepEqual(asset.uses.map(u=>u.frameId),['board-0','board-1','board-2']);assert.ok(zip.file(prefix+asset.path));}assert.equal(assets.find(a=>a.format==='png').scale,3);assert.equal(Object.values(zip.files).filter(f=>!f.dir&&f.name.startsWith(prefix+'assets/')).length,2);assert.equal(report.optimization.validated,true);assert.equal(report.optimization.sharedAssets.length,2);assert.match(h.$('status').textContent,/共享切图 2 份/);
});


test('unmarked image fills, strokes and nested image containers never become separate assets',async()=>{
 const h=harness({initialSelection:true});await h.drain();
 function small(id,parent,type='RECTANGLE'){const n=frame(id,parent,type);n.width=24;n.height=24;return n;}
 const direct=small('avatar',h.a);direct.fills=[{type:'IMAGE',imageHash:'photo'}];
 const stroke=small('image-stroke',h.a,'VECTOR');stroke.strokes=[{type:'IMAGE',imageHash:'stroke'}];
 const outer=small('avatar-component',h.a,'INSTANCE'),inner=small('image-group',outer,'GROUP'),photo=small('nested-photo',inner);photo.fills=[{type:'IMAGE',imageHash:'nested'}];
 const large=frame('large-photo',h.a);large.fills=[{type:'IMAGE',imageHash:'large'}];
 for(const n of [direct,stroke,outer,inner,photo,large])n.exportAsync=async()=>{throw Error('Unconfigured image must not be exported as an asset')};
 await h.$('export').onclick();await h.drain();const done=h.outgoing.find(m=>m.type==='complete');assert.ok(done,h.$('status').textContent);assert.equal(done.assets.length,0);assert.equal(done.assetFailures.length,0);assert.equal(done.previews.length,1);assert.equal(h.$('download').hidden,false);
});

test('configured images and containers keep their own Export formats and PNG size',async()=>{
  const h=harness({initialSelection:true});await h.drain();
  const photo=frame('configured-photo',h.a,'RECTANGLE');photo.width=24;photo.height=24;photo.fills=[{type:'IMAGE',imageHash:'photo'}];photo.exportSettings=[{format:'PNG',constraint:{type:'SCALE',value:1}}];
  const group=frame('configured-image-container',h.a,'GROUP');group.width=32;group.height=32;group.exportSettings=[{format:'SVG'}];group.exportAsync=async()=>new TextEncoder().encode('<svg/>');const child=frame('child-image',group,'RECTANGLE');child.fills=[{type:'IMAGE',imageHash:'nested'}];
  await h.$('export').onclick();await h.drain();const done=h.outgoing.find(m=>m.type==='complete');assert.ok(done,h.$('status').textContent);assert.equal(done.assets.length,2);assert.equal(done.assetFailures.length,0);const png=done.assets.find(a=>a.format==='png');assert.equal(png.scale,1);assert.equal(png.pixelWidth,24);assert.equal(png.nodeIds[0],photo.id);assert.equal(done.assets.find(a=>a.format==='svg').nodeIds[0],group.id);
});

test('unmarked vectors and unsupported Export formats yield previews without independent cutouts',async()=>{
 const h=harness({initialSelection:true});await h.drain();
 const icon=frame('unconfigured-vector',h.a,'VECTOR');icon.width=20;icon.height=20;
 const photo=frame('jpg-only-photo',h.a,'RECTANGLE');photo.width=20;photo.height=20;photo.fills=[{type:'IMAGE',imageHash:'photo'}];photo.exportSettings=[{format:'JPG'}];
 await h.$('export').onclick();await h.drain();const done=h.outgoing.find(m=>m.type==='complete');assert.ok(done,h.$('status').textContent);assert.equal(done.assets.length,0);assert.equal(done.previews.length,1);
});

test('SVG-only Export does not add a PNG companion, and the UI sends no automatic asset option',async()=>{
 const h=harness({initialSelection:true});await h.drain();const n=frame('svg-only-icon',h.a,'VECTOR');n.width=24;n.height=24;n.exportSettings=[{format:'SVG'}];const calls=[];n.exportAsync=async setting=>{calls.push(setting.format);return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>')};
 const unmarked=frame('unmarked-icon',h.a,'VECTOR');unmarked.width=16;unmarked.height=16;unmarked.exportAsync=async()=>{throw Error('Unmarked icon must not be exported')};
 await h.$('export').onclick();await h.drain();const done=h.outgoing.find(m=>m.type==='complete');assert.ok(done,h.$('status').textContent);assert.deepEqual(calls,['SVG']);assert.equal(done.assets.length,1);assert.equal(done.assets[0].format,'svg');assert.equal(done.previews.length,1);assert.equal(Object.hasOwn(h.sent.find(m=>m.type==='export').options,'autoAssets'),false);
 const zip=await JSZip.loadAsync(await h.blob().arrayBuffer()),name=Object.keys(zip.files).find(p=>p.endsWith('data/assets.json')),assets=JSON.parse(await zip.file(name).async('string'));assert.equal(assets.length,1);assert.equal(assets[0].format,'svg');assert.equal(Object.values(zip.files).filter(f=>!f.dir&&/\/assets\/.+\.png$/.test(f.name)).length,0);
});

test('an exported parent does not implicitly export descendants or suppress a child with its own Export setting',async()=>{
 const h=harness({initialSelection:true});await h.drain();const parent=frame('marked-container',h.a,'GROUP');parent.exportSettings=[{format:'SVG'}];parent.exportAsync=async()=>new TextEncoder().encode('<svg/>');
 const marked=frame('marked-child',parent,'VECTOR');marked.exportSettings=[{format:'PNG'}];marked.width=20;marked.height=20;
 const unmarked=frame('unmarked-child',parent,'VECTOR');unmarked.width=24;unmarked.height=24;unmarked.exportAsync=async()=>{throw Error('No Export setting')};
 await h.$('export').onclick();await h.drain();const done=h.outgoing.find(m=>m.type==='complete');assert.ok(done,h.$('status').textContent);assert.equal(done.assets.length,2);assert.deepEqual(Array.from(done.assets,a=>a.nodeIds[0]),['marked-container','marked-child']);assert.deepEqual(Array.from(done.assets,a=>a.format),['svg','png']);assert.equal(done.assetFailures.length,0);
});


test('custom delivery name is shared by ZIP and folder for new exports and partial updates',async()=>{
 const h=harness({initialSelection:true});await h.drain();h.$('packageName').value='1022 版本 XX.zip';h.$('packageName').oninput();assert.equal(h.$('packageNamePreview').textContent,'1022 版本 XX.zip');
 await h.$('export').onclick();await h.drain();assert.equal(h.$('download').download,'1022 版本 XX.zip');
 let zip=await JSZip.loadAsync(await h.blob().arrayBuffer());assert.ok(Object.keys(zip.files).every(p=>p.startsWith('1022 版本 XX/')));
 const design=JSON.parse(await zip.file('1022 版本 XX/data/design.json').async('string'));assert.equal(design.title,'Fixture');
 h.ui.oldBytes=new Uint8Array(await h.blob().arrayBuffer());await vm.runInContext('readBaseline(oldBytes).then(b=>baseline=b)',h.ui);h.choice.mode.value='update';h.$('sameFile').checked=true;
 h.$('packageName').value='1023 版本 YY';h.$('packageName').oninput();assert.equal(h.$('download').hidden,true);assert.match(h.$('status').textContent,/重新生成/);
 await h.$('export').onclick();await h.drain();assert.equal(h.$('download').download,'1023 版本 YY.zip');zip=await JSZip.loadAsync(await h.blob().arrayBuffer());assert.ok(Object.keys(zip.files).every(p=>p.startsWith('1023 版本 YY/')));assert.ok(zip.file('1023 版本 YY/index.html'));assert.equal(JSON.parse(await zip.file('1023 版本 YY/data/design.json').async('string')).title,'Fixture');
});

test('custom names survive selection refresh and validation precedes native export',async()=>{
 const h=harness({initialSelection:true});await h.drain();h.$('packageName').value='1022 版本 XX';await h.$('refreshSelection').onclick();await h.drain();assert.equal(h.$('packageName').value,'1022 版本 XX');
 for(const bad of ['../secret','CON','.zip','bad.','a'.repeat(91)]){
  h.$('packageName').value=bad;await h.$('export').onclick();await h.drain();assert.ok(!h.sent.some(m=>m.type==='export'));assert.equal(h.$('export').disabled,false);assert.equal(h.$('download').hidden,true);
 }
 h.$('packageName').value='';await h.$('export').onclick();await h.drain();assert.equal(h.$('download').download,'Fixture-离线交付.zip');
});

test('an optional ZIP suffix is removed only once in the captured delivery name',async()=>{
 const h=harness({initialSelection:true});await h.drain();h.$('packageName').value='示例.zip.zip';h.$('packageName').oninput();await h.$('export').onclick();await h.drain();assert.equal(h.$('download').download,'示例.zip.zip');const zip=await JSZip.loadAsync(await h.blob().arrayBuffer());assert.ok(zip.file('示例.zip/index.html'));
});

test('collector preserves locked and hidden child layers for read-only tree inspection',async()=>{
 const h=harness({initialSelection:true});await h.drain();const parent=frame('locked-group',h.a,'GROUP');parent.locked=true;const child=frame('hidden-child',parent,'RECTANGLE');child.visible=false;child.locked=false;
 await h.$('export').onclick();await h.drain();const done=h.outgoing.find(m=>m.type==='complete');assert.ok(done,h.$('status').textContent);
 const groupData=done.design.nodes.find(n=>n.id===parent.id),childData=done.design.nodes.find(n=>n.id===child.id);assert.equal(groupData.locked,true);assert.equal(childData.parentId,parent.id);assert.equal(childData.visible,false);assert.equal(childData.locked,false);assert.equal(parent.locked,true);assert.equal(child.visible,false);
});

test('native Figma CSS survives bridge and ZIP unchanged, including empty native results',async()=>{
 const h=harness({initialSelection:true});await h.drain();const gradient=frame('gradient',h.a,'RECTANGLE');gradient.layoutPositioning='ABSOLUTE';gradient.layoutAlign='STRETCH';gradient.layoutGrow=0;
 const css={width:'273px',height:'90px',position:'absolute','border-radius':'16px',background:'linear-gradient(297deg, var(--brand, #F60) 0%, #FFFFFF00 100%)'};
 gradient.getCSSAsync=async()=>css;h.a.getCSSAsync=async()=>({});await h.$('export').onclick();await h.drain();assert.equal(h.$('download').hidden,false,h.$('status').textContent);
 const z=await JSZip.loadAsync(await h.blob().arrayBuffer()),file=Object.keys(z.files).find(n=>n.endsWith('data/design.json')),d=JSON.parse(await z.file(file).async('string')),n=d.nodes.find(n=>n.id==='gradient');
 assert.deepEqual(n.figmaCSS,css);assert.equal(n.layoutPositioning,'ABSOLUTE');assert.equal(n.layoutAlign,'STRETCH');assert.equal(n.layoutGrow,0);assert.deepEqual(d.nodes[0].figmaCSS,{});assert.deepEqual(css,await gradient.getCSSAsync());
});

test('one failed native CSS request preserves other native CSS and completes with an actionable warning',async()=>{
 const h=harness({initialSelection:true});await h.drain();const child=frame('failed-css',h.a);child.getCSSAsync=async()=>{throw Error('CSS unavailable')};h.a.getCSSAsync=async()=>({display:'flex'});
 await h.$('export').onclick();await h.drain();const done=h.outgoing.find(m=>m.type==='complete');assert.ok(done,h.$('status').textContent);assert.equal(done.design.nodes[0].figmaCSS.display,'flex');assert.equal(done.design.nodes[1].figmaCSS,undefined);assert.match(done.warnings.join('\n'),/Design failed-css（failed-css）：CSS unavailable/);assert.equal(h.$('download').hidden,false);
});

test('cancelling while reading native CSS does not yield a completed export',async()=>{
 const h=harness({initialSelection:true});await h.drain();h.a.getCSSAsync=async()=>{await h.native.figma.ui.onmessage({channel:h.channel,type:'cancel'});return {width:'160px'}};
 await h.$('export').onclick();await h.drain();assert.ok(!h.outgoing.some(m=>m.type==='complete'));assert.ok(h.outgoing.some(m=>m.type==='error'&&m.message.includes('取消')));
});

test('geometry changed during native CSS collection still rejects a mixed snapshot',async()=>{
 const h=harness({initialSelection:true});await h.drain();h.a.getCSSAsync=async()=>{h.a.name='Changed';return {width:'160px'}};
 await h.$('export').onclick();await h.drain();assert.ok(!h.outgoing.some(m=>m.type==='complete'));assert.ok(h.outgoing.some(m=>m.type==='error'&&m.message.includes('发生变化')));
});

test('used color variables/styles retain names and per-node modes with cached lookups, without changing Figma',async()=>{
 const h=harness({initialSelection:true});await h.drain();const other=frame('dark-child',h.a,'RECTANGLE');
 for(const n of [h.a,other]){n.fillStyleId='s1';n.resolvedVariableModes={collection:n===h.a?'light':'dark'};n.fills=[{type:'SOLID',color:{r:n===h.a?1:0,g:0,b:0},boundVariables:{color:{type:'VARIABLE_ALIAS',id:'v1'}}}];}
 let variableReads=0,collectionReads=0,styleReads=0;h.native.figma.variables={getVariableByIdAsync:async id=>{variableReads++;return{id,name:'颜色/主题',variableCollectionId:'collection',codeSyntax:{WEB:'var(--brand)'}}},getVariableCollectionByIdAsync:async()=>{collectionReads++;return{name:'品牌色',modes:[{modeId:'light',name:'明亮'},{modeId:'dark',name:'深色'}]}}};h.native.figma.getStyleByIdAsync=async id=>{styleReads++;return{id,name:'主题填充'}};
 const before=JSON.stringify(h.a.fills);await h.$('export').onclick();await h.drain();const done=h.outgoing.find(m=>m.type==='complete');assert.ok(done,h.$('status').textContent);
 const root=done.design.nodes[0].colorBindings[0],child=done.design.nodes[1].colorBindings[0];assert.equal(root.variable.name,'颜色/主题');assert.equal(root.variable.modeName,'明亮');assert.equal(child.variable.modeName,'深色');assert.equal(root.variable.cssName,'var(--brand)');assert.equal(root.style.name,'主题填充');assert.equal(root.path,'fills.0');assert.equal(variableReads,1);assert.equal(collectionReads,1);assert.equal(styleReads,1);assert.equal(JSON.stringify(h.a.fills),before);
});

test('unavailable variable metadata does not abort an otherwise valid export',async()=>{
 const h=harness({initialSelection:true});await h.drain();h.a.fills=[{type:'SOLID',color:{r:1,g:0,b:0},boundVariables:{color:{type:'VARIABLE_ALIAS',id:'missing'}}}];h.native.figma.variables={getVariableByIdAsync:async()=>{throw Error('Unavailable library')}};
 await h.$('export').onclick();await h.drain();const done=h.outgoing.find(m=>m.type==='complete');assert.ok(done,h.$('status').textContent);assert.equal(done.design.nodes[0].colorBindings,undefined);assert.equal(done.design.nodes[0].fills[0].boundVariables.color.id,'missing');assert.equal(h.$('download').hidden,false);
});


test('a subsequent successful export clears previous failure details without hiding arbitrary errors',async()=>{
 const h=harness({initialSelection:true});await h.drain();const n=frame('broken',h.a,'VECTOR');n.exportSettings=[{format:'SVG'}];n.exportAsync=async()=>{throw Error('specific SVG export error')};
 await h.$('export').onclick();await h.drain();assert.equal(h.$('failureDetails').hidden,false);assert.match(h.$('failureList').textContent,/specific SVG export error/);assert.equal(h.$('download').hidden,false);
 n.exportAsync=async()=>new TextEncoder().encode('<svg/>');await h.$('export').onclick();await h.drain();assert.equal(h.$('failureDetails').hidden,true);assert.equal(h.$('failureList').textContent,'');assert.doesNotMatch(h.$('status').textContent,/切图失败/);assert.equal(h.$('download').hidden,false);
});
