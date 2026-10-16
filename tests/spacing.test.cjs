const {test}=require('node:test'),assert=require('node:assert/strict');
const S=require('../viewer/spacing.js');
function node(id,x,y,width,height,parentId=null,extra={}){return{id,name:id,width,height,parentId,regionId:parentId||id,visible:true,absoluteTransform:[[1,0,x],[0,1,y]],absoluteBoundingBox:{x,y,width,height},...extra};}
test('real padding and auto-distributed gap retain their meaning; measurements do not create margin',()=>{
 const n=node('p',0,0,200,100,null,{layoutMode:'HORIZONTAL',paddingTop:8,paddingRight:16,paddingBottom:12,paddingLeft:24,itemSpacing:9,primaryAxisAlignItems:'SPACE_BETWEEN'}),m=S.create([n]).measure('p');assert.deepEqual(m.inner.values,{top:8,right:16,bottom:12,left:24});assert.equal(m.inner.source,'padding');assert.equal(m.inner.gap,'AUTO');assert.equal(m.parent,null);assert.equal(m.lines.length,4);assert.ok(!('margin' in m));
});
test('ordinary frames show measured child whitespace, not fabricated padding',()=>{const p=node('p',0,0,100,80),c=node('c',10,20,50,30,'p'),hidden=node('h',0,0,100,80,'p',{visible:false});const m=S.create([p,c,hidden]).measure('p');assert.equal(m.inner.source,'content');assert.deepEqual(m.inner.values,{top:20,right:40,bottom:30,left:10});});
test('four nearest siblings require orthogonal overlap and ignore hidden, overlapping and diagonal layers',()=>{
 const p=node('p',0,0,400,300),n=node('n',100,100,50,50,'p');const siblings=[node('t',110,50,20,20,'p'),node('r',180,110,20,20,'p'),node('b',110,170,20,20,'p'),node('l',60,110,20,20,'p'),node('hidden',151,100,10,10,'p',{visible:false}),node('overlap',120,120,20,20,'p'),node('diag',151,151,10,10,'p')];const m=S.create([p,n,...siblings]).measure('n');assert.deepEqual(m.parent.values,{top:100,right:250,bottom:150,left:100});assert.deepEqual(Object.fromEntries(Object.entries(m.neighbors).map(([k,v])=>[k,v.distance])),{top:30,right:30,bottom:20,left:20});assert.equal(m.overlapCount,1);
});
test('rotated parent uses its local axes; line endpoints return to canvas coordinates',()=>{const p=node('p',0,0,200,100,null,{absoluteTransform:[[0,-1,100],[1,0,100]]}),c=node('c',0,0,40,30,'p',{absoluteTransform:[[0,-1,80],[1,0,110]]});const m=S.create([p,c]).measure('c');assert.deepEqual(m.parent.values,{top:20,right:150,bottom:50,left:10});assert.equal(m.approximate,false);const top=m.lines.find(l=>l.side==='top');assert.deepEqual(top.from,{x:100,y:130});assert.deepEqual(top.to,{x:80,y:130});});
test('negative parent edge distance records overflow, touching siblings measure zero',()=>{const p=node('p',0,0,100,100),n=node('n',-5,10,20,20,'p'),q=node('q',15,10,20,20,'p');const m=S.create([p,n,q]).measure('n');assert.equal(m.parent.values.left,-5);assert.equal(m.neighbors.right.distance,0);});
test('separate Pages do not become neighbors and fully clipped siblings are excluded',()=>{const a=node('a',0,0,100,100),b=node('b',120,0,100,100);const engine=S.create([a,b],[{id:'p1',regions:['a']},{id:'p2',regions:['b']}]);assert.deepEqual(engine.measure('a').neighbors,{});const p=node('p',0,0,100,100,null,{clipsContent:true}),c=node('c',70,10,20,20,'p'),outside=node('out',110,10,20,20,'p');assert.deepEqual(S.create([p,c,outside]).measure('c').neighbors,{});});
test('singular transformations do not output invalid distances; source records remain immutable',()=>{const p=node('p',0,0,100,100,null,{absoluteTransform:[[0,0,0],[0,0,0]]}),n=node('n',0,0,20,20,'p'),before=JSON.stringify([p,n]);const m=S.create([p,n]).measure('n');assert.ok(m.error);assert.deepEqual(m.lines,[]);assert.equal(JSON.stringify([p,n]),before);});

test('Frame guides use the owning Frame axes through nested rotated parents',()=>{
 const f=node('f',0,0,200,100,null,{absoluteTransform:[[0,-1,100],[1,0,100]],frameId:'f'}),p=node('p',0,0,100,80,'f',{absoluteTransform:[[0,-1,90],[1,0,105]],frameId:'f'}),c=node('c',0,0,40,30,'p',{absoluteTransform:[[0,-1,80],[1,0,110]],frameId:'f'});
 const engine=S.create([f,p,c]),guide=engine.frame('c');assert.deepEqual(guide.values,{top:20,right:150,bottom:50,left:10});assert.equal(guide.lines.length,4);assert.equal(guide.lines[0].kind,'frame');assert.deepEqual(guide.lines[0].from,{x:100,y:130});assert.equal(engine.frame('f'),null);
});
test('layout bands use actual space-between child gaps and distinguish measured whitespace',()=>{
 const p=node('p',0,0,200,100,null,{layoutMode:'HORIZONTAL',paddingTop:10,paddingRight:20,paddingBottom:10,paddingLeft:20,itemSpacing:7,primaryAxisAlignItems:'SPACE_BETWEEN'}),a=node('a',20,10,40,80,'p'),b=node('b',140,10,40,80,'p'),hidden=node('h',65,10,30,80,'p',{visible:false}),before=JSON.stringify([p,a,b,hidden]);
 let result=S.create([p,a,b,hidden]).layout('p');assert.equal(result.bands.filter(b=>b.kind==='padding').length,4);assert.equal(result.bands.find(b=>b.kind==='gap').value,80);assert.equal(result.bands.find(b=>b.kind==='gap').width,80);assert.ok(result.bands.filter(b=>b.kind==='padding').every(b=>b.source==='padding'));assert.equal(JSON.stringify([p,a,b,hidden]),before);
 const ordinary={...p,layoutMode:'NONE'};result=S.create([ordinary,a,b]).layout('p');assert.ok(result.bands.every(b=>b.kind==='padding'&&b.source==='content'));
});
test('wrapped/grid gap bands preserve both axes and cap work for large containers',()=>{
 const p=node('p',0,0,150,150,null,{layoutMode:'GRID'}),children=[node('a',0,0,40,40,'p'),node('b',56,0,40,40,'p'),node('c',0,60,40,40,'p'),node('d',56,60,40,40,'p')],result=S.create([p,...children]).layout('p');
 assert.ok(result.bands.some(b=>b.kind==='gap'&&b.axis==='x'&&b.value===16));assert.ok(result.bands.some(b=>b.kind==='gap'&&b.axis==='y'&&b.value===20));
 const huge=S.create([p,...Array.from({length:230},(_,i)=>node('c'+i,(i%10)*50,Math.floor(i/10)*50,40,40,'p'))]).layout('p');assert.equal(huge.limited,true);assert.ok(huge.bands.length<=100);
});


test('hover target measurement isolates gaps, containment and diagonal axes without changing nodes',()=>{
 const p=node('p',0,0,400,300),n=node('n',100,100,50,50,'p'),q=node('q',180,110,20,20,'p'),d=node('d',200,200,20,20,'p'),hidden=node('hidden',200,100,20,20,'p',{visible:false});
 const before=JSON.stringify([p,n,q,d,hidden]),engine=S.create([p,n,q,d,hidden]);
 assert.deepEqual(engine.between('n','q').lines.map(l=>[l.side,l.value]),[['right',30]]);
 assert.deepEqual(engine.between('n','d').lines.map(l=>[l.side,l.value]),[['right',50],['bottom',50]]);
 assert.equal(engine.between('n','n'),null);assert.equal(engine.between('n','hidden'),null);assert.equal(engine.between('n','missing'),null);
 assert.equal(JSON.stringify([p,n,q,d,hidden]),before);
 const child=node('child',10,20,40,30,'p',{regionId:'p'}),target={...p,regionId:'p'};
 assert.deepEqual(S.create([target,child]).between('child','p').lines.map(l=>l.value),[20,350,250,10]);
});
test('target distances respect rotated parent axes and reject unrelated regions or singular transforms',()=>{
 const p=node('p',0,0,200,100,null,{absoluteTransform:[[0,-1,100],[1,0,100]]}),a=node('a',0,0,40,30,'p',{absoluteTransform:[[0,-1,80],[1,0,110]]}),b=node('b',0,0,40,30,'p',{absoluteTransform:[[0,-1,80],[1,0,170]]});
 let e=S.create([p,a,b]),line=e.between('a','b').lines[0];assert.equal(line.value,20);assert.deepEqual(line.from,{x:65,y:150});assert.deepEqual(line.to,{x:65,y:170});
 assert.equal(S.create([a,{...b,regionId:'other'}]).between('a','b'),null);
 assert.equal(S.create([{...a,frameId:'f1'},{...b,frameId:'f2'}]).between('a','b'),null);
 assert.equal(S.create([p,{...a,frameId:'f1'},{...b,frameId:'f1'}]).between('a','b').lines[0].value,20);
 e=S.create([{...p,absoluteTransform:[[0,0,0],[0,0,0]]},a,b]);assert.equal(e.between('a','b'),null);
});
