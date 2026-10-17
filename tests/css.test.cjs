const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../dist');
class Element{
 constructor(){this.handlers={};this.attributes={};this.value='';this.innerHTML='';this.style={};this.dataset={};this.scrollLeft=0;this.scrollTop=0;this.clientWidth=800;this.clientHeight=850;this.classList={add(){},remove(){},toggle(){}};}
 addEventListener(k,fn){this.handlers[k]=fn}setAttribute(k,v){this.attributes[k]=v}removeAttribute(){}getBoundingClientRect(){return{left:0,top:0}}
}
function viewer(fixture){
 const downloads=[],bodyChildren=[],events={},elements=new Map(),document={body:{append(el){bodyChildren.push(el)}},createElement(tag){const el=new Element();el.tagName=tag.toUpperCase();el.click=()=>downloads.push({href:el.href,filename:el.download});el.remove=()=>{const at=bodyChildren.indexOf(el);if(at>=0)bodyChildren.splice(at,1)};return el;},getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id)},querySelector(){return new Element()},querySelectorAll(){return[]},addEventListener(k,fn){events[k]=fn}};
 const n={id:'a',name:'Board',type:'FRAME',depth:0,regionId:'a',frameId:'a',pageId:'p',width:300,height:300,visible:true,absoluteBoundingBox:{x:0,y:0,width:300,height:300},absoluteTransform:[[1,0,0],[0,1,0]],fills:[]};
 const c={document,window:{HANDOFF:fixture||{pages:[{id:'p',name:'P1',regions:['a']}],nodes:[n],assets:[],previews:[{id:'a',path:'preview.png',pixelWidth:300,pixelHeight:300,scale:1}],navigation:['a']},addEventListener(){}},navigator:{},console,setTimeout,clearTimeout,Blob,atob,btoa,URL:{createObjectURL(){return 'blob:asset'},revokeObjectURL(){}}};vm.createContext(c);
 for(const file of ['spacing.js','viewer.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),c);
 return{run:s=>vm.runInContext(s,c),c,elements,downloads,bodyChildren,events};
}
const stops=[{position:0,color:{r:1,g:0,b:0,a:1}},{position:1,color:{r:0,g:0,b:1,a:1}}];
function gradient(transform,extra={}){return {type:'GRADIENT_LINEAR',gradientTransform:transform,gradientStops:stops,...extra};}
test('native CSS preserves gradient angle, variables, values and groups without guessed overrides',()=>{
 const {c,run}=viewer();c.n={width:999,height:999,figmaCSS:{width:'273px',height:'90px',position:'absolute','border-radius':'16px',background:'linear-gradient(297deg, var(--brand, #FF6600) 2.6%, rgba(255, 255, 255, 0) 99.5%)','box-shadow':'0px 4px 8px 0px #00000020','--custom':'x'}};
 const data=run('cssData(n)');assert.equal(data.native,true);assert.deepEqual(Array.from(data.groups.Layout,p=>p[0]),['width','height']);assert.deepEqual(Array.from(data.groups.Position,p=>p[0]),['position']);assert.equal(data.groups.Style.find(p=>p[0]==='background')[1],c.n.figmaCSS.background);
 assert.match(run('css(n)'),/\/\* Layout \*\/[\s\S]*\/\* Position \*\/[\s\S]*\/\* Style \*\//);assert.ok(!run('css(n)').includes('999'));assert.match(run('cssPanel(n)'),/代码模板/);assert.match(run('cssPanel(n)'),/linear-gradient\(297deg/);assert.doesNotMatch(run('cssPanel(n)'),/来源：|图层 JSON/);
 for(const type of ['css','android','ios'])assert.ok(run('cssPanel(n)').includes('data-code-template="'+type+'"'));
});
test('native text and layout attributes are not discarded and empty native results are not invented',()=>{
 const {c,run}=viewer();c.n={figmaCSS:{display:'flex','flex-shrink':'0','align-self':'stretch','padding-inline':'16px',gap:'8px',left:'12px',transform:'rotate(15deg)',color:'var(--text)',font:'400 14px/20px Inter'}};
 assert.equal(run('cssData(n).groups.Layout.length'),5);assert.equal(run('cssData(n).groups.Position.length'),2);assert.equal(run('cssData(n).groups.Style.length'),2);
 c.n={width:273,height:90,figmaCSS:{}};assert.equal(run('css(n)'),'');assert.equal(run('cssData(n).native'),true);
});
test('CSS code is escaped as text in the panel and copy attributes',()=>{
 const {c,run}=viewer();c.n={figmaCSS:{background:'url("</code><img src=x onerror=alert(1)>")'}};const panel=run('cssPanel(n)');assert.ok(!panel.includes('<img'));assert.match(panel,/&lt;img/);assert.match(panel,/&quot;/);assert.equal(run('cssData(n).groups.Style[0][1]'),c.n.figmaCSS.background);
});
test('legacy linear gradients preserve direction, offset, stop alpha and paint opacity',()=>{
 const {c,run}=viewer();c.n={width:273,height:90};
 for(const [matrix,angle]of [[[[1,0,0],[0,1,0]],90],[[[-1,0,1],[0,1,0]],270],[[[0,1,0],[-1,0,1]],180],[[[0,-1,1],[1,0,0]],0]]){c.p=gradient(matrix);assert.equal(run('linearGradientCSS(p,n)'),`linear-gradient(${angle}deg, #FF0000 0%, #0000FF 100%)`);}
 c.p=gradient([[2,0,-0.5],[0,1,0]]);assert.equal(run('linearGradientCSS(p,n)'),'linear-gradient(90deg, #FF0000 25%, #0000FF 75%)');
 c.p=gradient([[1,0,0],[0,1,0]],{opacity:0.5,gradientStops:[{position:0,color:{r:1,g:0,b:0,a:0.4}},{position:1,color:{r:0,g:0,b:1,a:1}}]});assert.match(run('linearGradientCSS(p,n)'),/rgba\(255, 0, 0, 0.2\) 0%/);
});
test('non-square gradient geometry uses physical dimensions instead of normalized angle',()=>{
 const {c,run}=viewer();const angle=297*Math.PI/180,w=273,h=90,ux=Math.sin(angle),uy=-Math.cos(angle),L=Math.abs(w*ux)+Math.abs(h*uy),a=ux*w/L,b=uy*h/L;
 c.n={width:w,height:h};c.p=gradient([[a,b,0.5-(a+b)/2],[-b,a,0]]);assert.equal(run('linearGradientCSS(p,n)'),'linear-gradient(297deg, #FF0000 0%, #0000FF 100%)');
});
test('legacy nodes group derived CSS, keep notes for unsupported gradients and do not invent margins',()=>{
 const {c,run}=viewer();c.n={width:273,height:90,parentId:'a',cornerRadius:16,fills:[gradient([[1,0,0],[0,1,0]])]};const text=run('css(n)');assert.match(text,/position: absolute;/);assert.match(text,/border-radius: 16px;/);assert.match(text,/linear-gradient\(90deg/);assert.ok(!text.includes('margin'));assert.doesNotMatch(run('cssPanel(n)'),/来源：/);
 c.n.fills=[{type:'GRADIENT_RADIAL',gradientStops:stops}];assert.ok(!run('css(n)').includes('background'));assert.match(run('cssData(n).notes.join(" ")'),/此填充暂不能完整推导/);
 c.p=gradient([[0,0,0],[0,0,0]]);assert.equal(run('linearGradientCSS(p,n)'),null);
});

function libraryFixture(){
 const node=(id,parentId,x,y,w,h,page='p')=>({id,parentId,regionId:parentId?'a':id,frameId:parentId?'a':id,pageId:page,depth:parentId?1:0,name:id,type:'RECTANGLE',width:w,height:h,visible:true,absoluteBoundingBox:{x,y,width:w,height:h},absoluteTransform:[[1,0,x],[0,1,y]],fills:[]});
 const a=node('a',null,0,0,300,300),b=node('b',null,500,0,200,200,'p2'),c=node('c','a',20,30,150,80);a.type='FRAME';b.type='FRAME';c.layoutMode='HORIZONTAL';c.paddingTop=c.paddingBottom=10;c.paddingLeft=c.paddingRight=20;c.cornerRadius=16;c.strokeWeight=1;c.strokeAlign='INSIDE';c.strokes=[{type:'SOLID',color:{r:0,g:0,b:1}}];c.fills=[{type:'SOLID',color:{r:1,g:0,b:0},boundVariables:{color:{type:'VARIABLE_ALIAS',id:'brand'}}}];c.effects=[{type:'DROP_SHADOW',offset:{x:0,y:4},radius:32,spread:-4,color:{r:0,g:0,b:0,a:.04}},{type:'INNER_SHADOW',offset:{x:1,y:2},radius:6,spread:0,color:{r:0,g:0,b:0,a:.2}}];c.colorBindings=[{path:'fills.0',variable:{id:'brand',name:'品牌红',modeId:'light',modeName:'明亮',collectionName:'主题'}}];
 const other=node('other','a',200,30,30,30);other.fills=[{type:'SOLID',color:{r:1,g:0,b:0}}];b.fills=[{type:'SOLID',color:{r:0,g:1,b:0}}];
 return{title:'QA',pages:[{id:'p',name:'P1',regions:['a']},{id:'p2',name:'P2',regions:['b']}],nodes:[a,c,other,b],assets:[{id:'asset',name:'shared',format:'svg',path:'assets/shared.svg',width:24,height:24,nodeIds:['c','b'],uses:[]}],previews:[{id:'a',path:'preview.png',pixelWidth:300,pixelHeight:300,scale:1},{id:'b',path:'preview2.png',pixelWidth:200,pixelHeight:200,scale:1}],navigation:['a','b']};
}
test('page color palette preserves semantic token identities and scopes used colors to each Page',()=>{
 const fixture=libraryFixture(),before=JSON.stringify(fixture),{run,c}=viewer(fixture);c.page='p';const list=run('paletteForPage(page)');assert.equal(list.filter(c=>c.source==='variable').length,1);assert.equal(list.find(c=>c.source==='variable').name,'品牌红');assert.equal(list.find(c=>c.source==='variable').variable.modeName,'明亮');assert.ok(list.some(c=>c.source==='color'&&c.color.r===1));assert.ok(!list.some(c=>c.color.g===1));assert.equal(run("paletteForPage('p2').length"),1);assert.equal(JSON.stringify(fixture),before);
});
test('left resource tabs preserve the right inspector and selection while page-scoped shared assets remain locatable',()=>{
 const fixture=libraryFixture(),{run,elements}=viewer(fixture);run("select('c');setLibrary('asset')");assert.equal(elements.get('assetPanel').hidden,false);assert.equal(elements.get('pagePanel').hidden,true);assert.equal(elements.get('inspectPanel').hidden,undefined);assert.equal(run('selected'),'c');assert.match(elements.get('assetList').innerHTML,/data-locate="c"/);assert.match(elements.get('assetList').innerHTML,/2 处共享/);assert.match(elements.get('assetList').innerHTML,/class="export-save"/);fixture.assetBundle='assets/resources.zip';const again=viewer(fixture);assert.equal(again.elements.get('assetBundle').hidden,false);assert.equal(again.elements.get('assetBundle').getAttribute?.('download')||again.elements.get('assetBundle').download,'切图.zip');assert.equal(again.elements.get('assetBundle').href,'assets/resources.zip');
 run("setLibrary('colors')");assert.equal(elements.get('colorPanel').hidden,false);assert.equal(elements.get('assetPanel').hidden,true);assert.match(elements.get('colorList').innerHTML,/品牌红/);assert.equal(run('selected'),'c');
});
test('MeaXure inspector keeps concise reference sections and native code without metadata clutter',()=>{
 const fixture=libraryFixture(),before=JSON.stringify(fixture);fixture.nodes[1].figmaCSS={width:'150px',height:'80px',background:'#FF0000',position:'absolute'};const{run,elements}=viewer(fixture);run("select('c')");const html=elements.get('inspectPanel').innerHTML;
 for(const label of ['属性','填充','边框','阴影','代码模板','内边框','外阴影','内阴影'])assert.ok(html.includes(label),label);
 assert.match(html,/品牌红/);assert.match(html,/-4px/);assert.match(html,/value="150px"/);assert.match(html,/position: absolute/);
 assert.doesNotMatch(html,/布局盒模型|Padding|图层 JSON|来源：|页面绝对位置|父级局部位置|旋转|主轴|复制 ID/);
 assert.equal(fixture.nodes[1].paddingLeft,20);assert.equal(JSON.parse(before).nodes[1].paddingLeft,20);
});
test('selected layers show dimensions only; hover draws target distance and four frame-spanning blue guides',()=>{
 const fixture=libraryFixture(),{run,c,elements}=viewer(fixture),overlay=new Element();overlay.dataset.overlay='a';c.document.querySelectorAll=s=>s==='[data-overlay]'?[overlay]:[];
 run("select('c')");assert.equal((overlay.innerHTML.match(/data-dimension=/g)||[]).length,2);assert.doesNotMatch(overlay.innerHTML,/data-spacing-kind|data-hover-guides/);
 run("hover='other';drawOverlay()");assert.match(overlay.innerHTML,/data-spacing-kind="target"/);assert.match(overlay.innerHTML,/>30<\/text>/);assert.match(overlay.innerHTML,/data-hover-guides="other"/);assert.match(overlay.innerHTML,/M200 0L200 300/);assert.match(overlay.innerHTML,/M0 30L300 30/);assert.doesNotMatch(overlay.innerHTML,/data-dimension|父 |内 |Gap /);
 elements.get('viewport').handlers.pointerleave();assert.equal(run('selected'),'c');assert.doesNotMatch(overlay.innerHTML,/data-spacing-kind|data-hover-guides/);assert.match(overlay.innerHTML,/data-dimension/);
 run("zoom=.5;hover='other';drawOverlay()");assert.match(overlay.innerHTML,/stroke-width="2"/);assert.match(overlay.innerHTML,/stroke-dasharray="6 4"/);assert.match(overlay.innerHTML,/font-size="24"/);
 run('annotations=false;drawOverlay()');assert.doesNotMatch(overlay.innerHTML,/data-hover-guides|data-spacing-kind|data-dimension/);assert.match(overlay.innerHTML,/data-selected-outline/);
});
test('mixed text keeps source segments while concise font fields and layer names remain escaped',()=>{
 const fixture=libraryFixture(),text=fixture.nodes[1];Object.assign(text,{type:'TEXT',name:'<script>bad</script>',characters:'标题正文',fontName:'MIXED',fontSize:'MIXED',textSegments:[{start:0,end:2,characters:'标题',fontName:{family:'Inter',style:'Bold'},fontSize:18,fontWeight:700,lineHeight:{unit:'PIXELS',value:24},letterSpacing:{unit:'PIXELS',value:0}},{start:2,end:4,characters:'正文',fontName:{family:'Inter',style:'Regular'},fontSize:14,fontWeight:400}]});
 const before=JSON.stringify(fixture),{run,elements}=viewer(fixture);run("select('c')");const html=elements.get('inspectPanel').innerHTML;assert.match(html,/混合/);assert.match(html,/标题正文/);assert.match(html,/字体/);assert.ok(!html.includes('<script>bad</script>'));assert.match(html,/&lt;script&gt;/);assert.equal(JSON.stringify(fixture),before);
});

function exportFixture(){
 const d=libraryFixture(),owner=d.nodes[1];owner.name='图标/任务';owner.width=24;owner.height=24;owner.absoluteBoundingBox.width=24;owner.absoluteBoundingBox.height=24;
 const child={...owner,id:'path',name:'路径',type:'VECTOR',parentId:'c',depth:2,width:8,height:10,absoluteBoundingBox:{x:22,y:32,width:8,height:10},absoluteTransform:[[1,0,22],[0,1,32]],fills:[],strokes:[],effects:[]};d.nodes.splice(2,0,child);
 const svg=d.assets[0];Object.assign(svg,{name:'shared-physical-name',width:24,height:24,scaleLabel:'矢量',uses:[{nodeId:'c',name:'任务图标.svg'},{nodeId:'b',name:'其他实例'}]});
 d.assets.push({id:'png',name:'shared-png',format:'png',path:'assets/shared.png',width:24,height:24,pixelWidth:48,pixelHeight:48,scale:2,scaleLabel:'2×',nodeIds:['c'],uses:[{nodeId:'c',name:'任务图标'}]});return d;
}
test('export panel shows downloadable real formats near properties and uses the nearest asset owner',()=>{
 const fixture=exportFixture(),before=JSON.stringify(fixture),{run,elements}=viewer(fixture);run("select('path')");assert.equal(run("exportContext(byId.get('path')).owner.id"),'c');const html=elements.get('exportDock').innerHTML;
 assert.equal(elements.get('exportDock').hidden,false);assert.doesNotMatch(elements.get('inspectPanel').innerHTML,/asset-export-section/);assert.doesNotMatch(html,/所属导出图层/);assert.match(html,/>Export</);assert.match(html,/任务图标\.svg/);assert.match(html,/任务图标\.png/);assert.match(html,/48 × 48 px/);assert.match(html,/class="export-save export-action"/);assert.match(html,/data-save-path="assets\/shared\.svg"/);assert.match(html,/data-save-name="任务图标\.svg"/);assert.match(html,/Export SVG/);assert.match(html,/直接下载/);assert.doesNotMatch(html,/target="_blank"|Option \/ Alt/);
 assert.equal(run("canvasExportSelection(['path','c','a'])"),'c');assert.equal(run("exportContext(byId.get('other')).items.length"),0);assert.equal(JSON.stringify(fixture),before);
});
test('a whole-board export remains downloadable without swallowing ordinary child inspection',()=>{
 const fixture=exportFixture();fixture.assets=[{id:'board',name:'board',format:'png',path:'assets/board.png',nodeIds:['a']}];const{run}=viewer(fixture);assert.equal(run("canvasExportSelection(['path','c','a'])"),'path');assert.equal(run("exportContext(byId.get('path')).owner.id"),'a');
});
test('export button saves original bytes instead of opening a preview',()=>{
 const fixture=exportFixture(),{run,elements,downloads}=viewer(fixture);run("select('c');rememberDownload('assets/shared.svg', btoa('<svg/>'))");let prevented=0;
 elements.get('exportDock').handlers.click({target:{closest:selector=>selector==='[data-save-path]'?{dataset:{savePath:'assets/shared.svg',saveName:'任务图标.svg'}}:null},preventDefault(){prevented++}});
 assert.equal(prevented,1);assert.equal(downloads.length,1);assert.equal(downloads[0].filename,'任务图标.svg');assert.equal(downloads[0].href,'blob:asset');
});
test('normal file-card click chooses a format; Alt-click preserves the native browser save action',()=>{
 const fixture=exportFixture(),{run,elements,downloads}=viewer(fixture);run("select('c')");let prevented=0;
 const event={target:{closest:selector=>selector==='[data-export-asset]'?{dataset:{exportAsset:'1'}}:null},preventDefault(){prevented++}};
 elements.get('exportDock').handlers.click(event);assert.equal(prevented,1);assert.equal(run('preferredAsset(exportContext(byId.get(selected))).format'),'png');
 elements.get('exportDock').handlers.click({...event,altKey:true});assert.equal(prevented,1);assert.equal(downloads.length,0);assert.equal(run('exportChoice.ownerId'),'c');
});
test('Alt+canvas click resolves an exported icon without cancelling the real link default action',()=>{
 const fixture=exportFixture(),{run,c,downloads}=viewer(fixture);let prevented=0;const region={dataset:{region:'a'},getBoundingClientRect:()=>({left:0,top:0})},link={dataset:{nativeDownload:'0'}};
 c.e={altKey:true,target:{closest:selector=>selector==='[data-region]'?region:selector==='[data-native-download]'?link:null},preventDefault(){prevented++}};
 run('zoom=1;e.clientX=24;e.clientY=34;handleCanvasClick(e)');assert.equal(run('selected'),'c');assert.equal(run('exportChoice.index'),0);assert.equal(prevented,0);assert.equal(downloads.length,0);
});
test('shared asset names follow the selected instance and unsafe file-name characters are sanitized',()=>{
 const fixture=exportFixture(),{run,c}=viewer(fixture);assert.equal(run("assetFilename(assets[0],byId.get('b'))"),'其他实例.svg');c.a={format:'png',name:'bad/name:*?.png'};assert.equal(run('assetFilename(a,null)'),'bad-name---.png');c.a.name='CON';assert.equal(run('assetFilename(a,null)'),'asset-CON.png');c.a.name='🙂'.repeat(100);assert(Buffer.byteLength(run('assetFilename(a,null)'),'utf8')<255);
});

test('empty and hidden paints and effects omit entire inspector sections while visible zero values remain',()=>{
 const {c,run}=viewer();
 for(const n of [{},{fills:[],strokes:[],effects:[]},{fills:'MIXED',strokes:'MIXED',effects:null},{fills:[{type:'SOLID',visible:false}],strokes:[{type:'SOLID',visible:false}],effects:[{type:'DROP_SHADOW',visible:false}]}]){
  c.n=n;for(const panel of ['fillsPanel','bordersPanel','shadowsPanel'])assert.equal(run(panel+'(n)'),'');
 }
 c.n={fills:[{type:'SOLID',color:{r:0,g:0,b:0},opacity:0}],strokes:[{type:'SOLID',color:{r:0,g:0,b:0}}],strokeWeight:0,effects:[{type:'LAYER_BLUR',radius:0}]};
 assert.match(run('fillsPanel(n)'),/0%/);assert.match(run('bordersPanel(n)'),/0px/);assert.match(run('shadowsPanel(n)'),/图层模糊/);
});
test('sparse or empty native CSS never invents declarations and restores the reference code panel on another layer',()=>{
 const fixture=libraryFixture();fixture.nodes[0].figmaCSS={};fixture.nodes[1].figmaCSS={display:'flex',gap:'0px',position:'',background:'  '};
 const {run,elements}=viewer(fixture);run("select('a')");assert.doesNotMatch(elements.get('inspectPanel').innerHTML,/代码模板|图层 JSON|无可见/);
 run("select('c')");const html=elements.get('inspectPanel').innerHTML;assert.match(html,/代码模板/);assert.match(html,/gap: 0px/);assert.doesNotMatch(run("templateCode(byId.get('c'),'css')"),/position:|background:/);assert.doesNotMatch(html,/css-group|此图层没有返回|来源：/);
 assert.equal(run("cssData(byId.get('a')).native"),true);assert.equal(run("templateCode(byId.get('a'),'css')"),'');
});
test('platform template tabs, escaped source content and unit changes preserve design values',()=>{
 const fixture=libraryFixture(),n=fixture.nodes[1];n.type='TEXT';n.characters='A" <B>\n第二行';n.fontSize=14;n.fontName={family:'Inter',style:'Regular'};n.lineHeight={unit:'PIXELS',value:20};const before=JSON.stringify(fixture),{run,elements,c}=viewer(fixture);
 run("select('c');codeTemplate='android';renderInspector()");assert.match(elements.get('inspectPanel').innerHTML,/android:text=/);assert.match(elements.get('inspectPanel').innerHTML,/data-code-template="android" class="active"/);
 assert.match(run("templateCode(byId.get('c'),'android')"),/&quot;|&lt;/);run("codeTemplate='ios';renderInspector()");assert.match(elements.get('inspectPanel').innerHTML,/UILabel/);
 elements.get('unitSelect').onchange({target:{value:'pt'}});assert.match(elements.get('inspectPanel').innerHTML,/150pt/);assert.equal(elements.get('unitLabel').textContent,'iOS - pt');assert.equal(JSON.stringify(fixture),before);
});
