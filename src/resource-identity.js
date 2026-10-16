/* Conservative comparison of static SVGs. Originals are never rewritten.
 * Only local ID names and their references may differ. Everything else stays
 * significant, including text, attributes, shape order and numeric precision.
 */
(function(root){
'use strict';
const tags=new Set(('svg g defs symbol pattern marker use path rect circle ellipse line polyline polygon linearGradient radialGradient stop clipPath mask filter image title desc text tspan textPath feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence').split(' '));
const validId=/^[A-Za-z_][A-Za-z0-9_.:-]*$/;
function canonicalSvg(text){
 if(typeof text!=='string'||/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(text))return null;
 const tokens=[],ids=new Map(),stack=[];let cursor=0,roots=0;
 const markup=/<\?xml\s[\s\S]*?\?>|<!--[\s\S]*?-->|<\/?[A-Za-z][^<>]*>/g;
 function literal(value){if(value.includes('<')||/&(?!amp;|lt;|gt;|quot;|apos;|#[0-9]+;|#x[0-9a-fA-F]+;)/.test(value))throw Error();if(!stack.length&&value.trim())throw Error();tokens.push(['text',value]);}
 try{
  let m;
  while((m=markup.exec(text))){
   literal(text.slice(cursor,m.index));cursor=markup.lastIndex;const raw=m[0];
   if(raw.startsWith('<?')){if(roots||stack.length)throw Error();tokens.push(['xml',raw]);continue;}
   if(raw.startsWith('<!--')){if(raw.slice(4,-3).includes('--'))throw Error();tokens.push(['comment',raw]);continue;}
   const close=/^<\/([A-Za-z][\w.-]*)\s*>$/.exec(raw);
   if(close){if(stack.pop()!==close[1])throw Error();tokens.push(['close',close[1]]);continue;}
   const open=/^<([A-Za-z][\w.-]*)([\s\S]*?)(\/?)>$/.exec(raw);if(!open||!tags.has(open[1]))throw Error();
   if(!stack.length&&(open[1]!=='svg'||++roots!==1))throw Error();
   const attrs=[],names=new Set(),body=open[2],pattern=/\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/gy;let at=0,a;
   while((a=pattern.exec(body))){
    at=pattern.lastIndex;const name=a[1],value=a[2]===undefined?a[3]:a[2];
    if(names.has(name)||/^on/i.test(name)||/^(begin|end|aria-)/.test(name)||value.includes('\\')||/&(?!amp;|lt;|gt;|quot;|apos;|#[0-9]+;|#x[0-9a-fA-F]+;)/.test(value))throw Error();
    if(name==='xmlns'&&value!=='http://www.w3.org/2000/svg')throw Error();
    if(name.includes(':')&&!(name==='xmlns:xlink'&&value==='http://www.w3.org/1999/xlink')&&!['xlink:href','xml:space'].includes(name))throw Error();
    names.add(name);attrs.push([name,value]);
    if(name==='id'){if(!validId.test(value)||ids.has(value))throw Error();ids.set(value,ids.size);}
   }
   if(body.slice(at).trim())throw Error();
   tokens.push(['open',open[1],attrs,Boolean(open[3])]);if(!open[3])stack.push(open[1]);
  }
  literal(text.slice(cursor));if(stack.length||roots!==1)throw Error();
  function ref(id){if(!ids.has(id))throw Error();return ['ref',ids.get(id)];}
  for(const token of tokens)if(token[0]==='open')for(const attr of token[2]){
   const [name,value]=attr;
   if(name==='id'){attr[1]=['id',ids.get(value)];continue;}
   if(name==='href'||name==='xlink:href'){
    if(value.startsWith('#'))attr[1]=ref(value.slice(1));
    else if(!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(value))throw Error();
    continue;
   }
   const pattern=/url\(\s*(['"]?)#([A-Za-z_][A-Za-z0-9_.:-]*)\1\s*\)/g,parts=[];let at=0,p;
   while((p=pattern.exec(value))){parts.push(value.slice(at,p.index),ref(p[2]));at=pattern.lastIndex;}
   if(parts.length){parts.push(value.slice(at));if(parts.some(v=>typeof v==='string'&&/url\s*\(/i.test(v)))throw Error();attr[1]=parts;}
   else if(/url\s*\(/i.test(value))throw Error();
  }
  // Figma also embeds node IDs in filter result names (e.g. drop shadows).
  // Normalize those local variables together with in/in2, within each filter.
  const builtin=new Set(['SourceGraphic','SourceAlpha','BackgroundImage','BackgroundAlpha','FillPaint','StrokePaint']);
  let filter=null;
  for(let i=0;i<tokens.length;i++){
   const token=tokens[i];
   if(token[0]==='open'&&token[1]==='filter'){
    if(filter)throw Error();filter={results:new Map(),end:i};
    if(!token[3]){let j=i+1;for(;j<tokens.length;j++){if(tokens[j][0]==='open'&&tokens[j][1]==='filter')throw Error();if(tokens[j][0]==='close'&&tokens[j][1]==='filter')break;}if(j===tokens.length)throw Error();filter.end=j;}
    for(let j=i+1;j<filter.end;j++)if(tokens[j][0]==='open')for(const [name,value] of tokens[j][2])if(name==='result'){
     if(!tokens[j][1].startsWith('fe')||typeof value!=='string'||!validId.test(value)||builtin.has(value)||filter.results.has(value))throw Error();filter.results.set(value,filter.results.size);
    }
   }
   if(token[0]==='open')for(const attr of token[2])if(['result','in','in2'].includes(attr[0])){
    if(!filter||!token[1].startsWith('fe')||typeof attr[1]!=='string')throw Error();
    if(attr[0]!=='result'&&builtin.has(attr[1]))continue;
    if(!filter.results.has(attr[1]))throw Error();attr[1]=['filter-ref',filter.results.get(attr[1])];
   }
   if(filter&&i===filter.end)filter=null;
  }
  return JSON.stringify(tokens);
 }catch{return null;}
}
const api={canonicalSvg};if(typeof module==='object'&&module.exports)module.exports=api;else root.HandoffResource=api;
})(typeof window==='object'?window:globalThis);
