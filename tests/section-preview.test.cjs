const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const C=require('../src/package-core.js');
const source=fs.readFileSync(path.join(__dirname,'../code.js'),'utf8');
function png(w,h){const a=new Uint8Array(24),v=new DataView(a.buffer);v.setUint32(0,0x89504e47);v.setUint32(16,Math.round(w));v.setUint32(20,Math.round(h));return a;}
function add(parent,id,type,x,y,width,height){const b={x,y,width,height},n={id,name:id,type,parent,children:[],visible:true,x:x-(parent.absoluteBoundingBox?.x||0),y:y-(parent.absoluteBoundingBox?.y||0),width,height,absoluteBoundingBox:b,absoluteRenderBounds:{...b},absoluteTransform:[[1,0,x],[0,1,y]],fills:[],strokes:[],exportSettings:[]};parent.children.push(n);n.calls=[];n.exportAsync=async opts=>{n.calls.push(opts);const r=opts.useAbsoluteBounds?n.absoluteBoundingBox:n.absoluteRenderBounds;return png(r.width*opts.constraint.value,r.height*opts.constraint.value)};return n;}
function setup(){
 const page={id:'p',name:'Page',type:'PAGE',children:[],selection:[]},section=add(page,'section','SECTION',-2000,-3000,60000,25000),messages=[];
 section.fills=[{type:'SOLID',color:{r:1,g:1,b:1}}];
 // Reproduce Figma's mismatched Section preview without allowing code to depend on it.
 section.exportAsync=async()=>{throw Error('whole Section raster must not be called')};
 page.selection=[section];let channel;
 const figma={root:{name:'Large section',children:[page]},currentPage:page,fileKey:'key',base64Encode:a=>Buffer.from(a).toString('base64'),on(){},showUI(html){channel=html},ui:{postMessage:m=>messages.push(m)}};
 const context={figma,__html__:'__HANDOFF_CHANNEL__',Uint8Array,DataView,console};vm.createContext(context);vm.runInContext(source,context);
 return {section,page,figma,messages,context,async run(options={}){await figma.ui.onmessage({channel,runId:'run',type:'export',options:{mode:'new',scope:'selection',previewScale:3,autoAssets:false,...options}});const done=messages.find(m=>m.type==='complete');return {done,error:messages.find(m=>m.type==='error'),svg:Buffer.from(messages.find(m=>m.type==='file'&&m.path.endsWith('.svg'))?.bytes||[]).toString()};}};
}
test('whole huge Section uses individual 3x previews, preserves coordinates, order, loose nodes and nested Sections',async()=>{
 const h=setup(),a=add(h.section,'frame-a','FRAME',-1000,-2000,1440,900),nested=add(h.section,'nested','SECTION',12000,200,3000,2200),b=add(nested,'frame-b','FRAME',12300,500,1000,800),text=add(h.section,'annotation','TEXT',-800,-2800,500,100),hidden=add(h.section,'hidden','FRAME',0,0,100,100);hidden.visible=false;
 const {done,error,svg}=await h.run();assert.ok(done,error?.message);C.validate(done.design,done.assets,done.previews);
 const preview=done.previews[0];assert.equal(preview.displayWidth,60000);assert.equal(preview.displayHeight,25000);assert.equal(preview.format,'section-composite');assert.deepEqual(Array.from(preview.tiles,t=>[t.nodeId,t.x,t.y,t.scale]),[['frame-a',1000,1000,3],['frame-b',14300,3500,3],['annotation',1200,200,3]]);
 assert.equal(a.calls[0].constraint.value,3);assert.equal(b.calls[0].constraint.value,3);assert.equal(text.calls.length,1);assert.equal(hidden.calls.length,0);
 assert.deepEqual(Array.from(done.design.navigation),['frame-a','frame-b']);assert.equal(done.design.nodes.find(n=>n.id==='frame-b').absoluteBoundingBox.x,12300);
 assert.match(svg,/viewBox="0 0 60000 25000"/);assert.equal((svg.match(/data:image\/png;base64,/g)||[]).length,3);assert.ok(!svg.includes('https:'));assert.ok(svg.indexOf('x="1000"')<svg.indexOf('x="14300"'));
});
test('only an oversized individual preview is downscaled, recorded in tile metadata and warning',async()=>{
 const h=setup();add(h.section,'wide','FRAME',0,0,5000,1000);add(h.section,'normal','FRAME',10000,0,1000,1000);
 const {done,error}=await h.run();assert.ok(done,error?.message);assert.equal(done.previews[0].tiles[0].pixelWidth,8192);assert.equal(done.previews[0].tiles[0].scale,8192/5000);assert.equal(done.previews[0].tiles[1].scale,3);assert.equal(done.warnings.length,1);
});
test('overflow preview retries render bounds and places its image at the correct origin instead of stretching',async()=>{
 const h=setup(),n=add(h.section,'shadow','FRAME',-1000,-2000,100,100);n.absoluteRenderBounds={x:-1010,y:-2020,width:140,height:150};n.exportAsync=async opts=>{n.calls.push(opts);return png(140*opts.constraint.value,150*opts.constraint.value)};
 const {done,error,svg}=await h.run();assert.ok(done,error?.message);assert.deepEqual(n.calls.map(c=>c.useAbsoluteBounds),[true,false]);const tile=done.previews[0].tiles[0];assert.equal(tile.x,990);assert.equal(tile.y,980);assert.equal(tile.width,140);assert.match(svg,/x="990" y="980" width="140" height="150"/);
});
test('unmappable child bounds still fail with actual dimensions and node ID, never yielding a misaligned package',async()=>{
 const h=setup(),n=add(h.section,'bad','FRAME',0,0,100,100);n.exportAsync=async()=>png(50,70);
 const {done,error}=await h.run();assert.ok(!done);assert.match(error.message,/bad/);assert.match(error.message,/50×70/);assert.match(error.message,/300×300/);
});
test('direct masks or complex Section fills use native composition instead of losing visual semantics',async()=>{
 for(const complex of ['mask','fill']){const h=setup();if(complex==='mask')add(h.section,'mask','RECTANGLE',0,0,100,100).isMask=true;else h.section.fills=[{type:'GRADIENT_LINEAR'}];let calls=0;h.section.exportAsync=async opts=>{calls++;return png(h.section.width*opts.constraint.value,h.section.height*opts.constraint.value)};const {done,error}=await h.run();assert.ok(done,error?.message);assert.equal(calls,1);assert.match(done.previews[0].path,/\.png$/);}
});
test('Section background alpha, rounded corners and nested background position are preserved',async()=>{
 const h=setup();h.section.cornerRadius=20;h.section.fills=[{type:'SOLID',color:{r:1,g:0,b:0},opacity:0.5}];const n=add(h.section,'nested','SECTION',0,0,100,100);n.fills=[{type:'SOLID',color:{r:0,g:1,b:0}}];const {svg,error}=await h.run();assert.ok(!error,error?.message);assert.match(svg,/rgb\(255,0,0\)/);assert.match(svg,/fill-opacity="0.5"/);assert.match(svg,/A20 20/);assert.match(svg,/M2000 3000/);
});
test('a whole Section composite can replace the old root without touching unrelated preview or node data',async()=>{
 const h=setup();add(h.section,'frame','FRAME',0,0,100,100);const {done}=await h.run();const base={design:C.clone(done.design),assets:[],previews:C.clone(done.previews)};const extra={...C.clone(base.design.nodes[0]),id:'unrelated',regionId:'unrelated',frameId:'unrelated'};base.design.nodes.push(extra);base.design.pages[0].regions.push(extra.id);base.previews.push({id:extra.id,path:'previews/original.png',scale:1});const oldPreview=C.clone(base.previews[1]),oldNode=C.clone(extra);const result=C.merge(base,done,['section']);assert.deepEqual(result.previews[1],oldPreview);assert.deepEqual(result.design.nodes.at(-1),oldNode);assert.match(result.previews[0].path,/\.svg$/);
});

test('mixed corner radii retain explicit zero corners without attempting to convert the mixed symbol',async()=>{const h=setup();h.section.cornerRadius=Symbol('mixed');h.section.topLeftRadius=0;h.section.topRightRadius=12;h.section.bottomRightRadius=0;h.section.bottomLeftRadius=7;const {done,error,svg}=await h.run();assert.ok(done,error?.message);assert.match(svg,/M0 0H59988A12 12/);assert.match(svg,/A7 7/);});

test('default preview density is 2x for a 1440 by 900 Frame, independent of asset Export settings',async()=>{
 const h=setup(),frame=add(h.section,'desktop','FRAME',0,0,1440,900);const {done,error}=await h.run({previewScale:undefined});assert.ok(done,error?.message);const tile=done.previews[0].tiles[0];assert.equal(tile.scale,2);assert.equal(tile.pixelWidth,2880);assert.equal(tile.pixelHeight,1800);assert.equal(done.assets.length,0);assert.equal(frame.calls[0].constraint.value,2);
});
