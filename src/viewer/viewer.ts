// @ts-nocheck — formatted port of the previous script. Behavior is locked by tests.
'use strict';
const D = window.HANDOFF,
  nodes = D.nodes,
  assets = D.assets,
  byId = new Map(nodes.map((n) => [n.id, n]));
const allRegions = nodes.filter((n) => n.depth === 0),
  frames =
    D.navigation?.map((id) => byId.get(id)).filter(Boolean) ||
    nodes.filter(
      (n) =>
        n.depth === 1 && ['FRAME', 'COMPONENT', 'INSTANCE'].includes(n.type) && n.height >= 500,
    );
if (!frames.length) frames.push(...allRegions);
let pageId = D.pages[0].id,
  regions = [],
  bounds;
function usePage(id) {
  pageId = id;
  const ids = new Set(D.pages.find((p) => p.id === id).regions);
  regions = allRegions.filter((r) => ids.has(r.id));
  bounds = regions.reduce(
    (b, n) => {
      const r = n.absoluteBoundingBox;
      return {
        x: Math.min(b.x, r.x),
        y: Math.min(b.y, r.y),
        right: Math.max(b.right, r.x + r.width),
        bottom: Math.max(b.bottom, r.y + r.height),
      };
    },
    { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity },
  );
}
usePage(pageId);
const $ = (id) => document.getElementById(id),
  esc = (v) =>
    String(v ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
const num = (v) =>
  typeof v === 'number' ? Math.round(v * 100) / 100 : v === 'MIXED' ? '混合' : (v ?? '—');
const pad = 100;
let zoom = 1,
  selected = frames[0].id,
  focused = frames[0].id,
  hover = null,
  hitIds = [],
  panMode = false,
  space = false,
  drag = null,
  suppressClick = false,
  assetFilter = 'all',
  library = 'pages',
  directory = 'boards',
  annotations = true,
  codeTemplate = 'css';
const regionNodes = new Map(
  allRegions.map((r) => [r.id, nodes.filter((n) => n.regionId === r.id && n.visible)]),
);
// Index once; render only expanded branches of the current Page.
const layerCounts = new Map(),
  layerChildren = new Map(),
  layerIndexes = new Map(nodes.map((n, i) => [n.id, i]));
for (const n of nodes) {
  layerCounts.set(n.regionId, (layerCounts.get(n.regionId) || 0) + 1);
  if (n.parentId && byId.has(n.parentId)) {
    if (!layerChildren.has(n.parentId)) layerChildren.set(n.parentId, []);
    layerChildren.get(n.parentId).push(n);
  }
}
const expandedLayers = new Set(allRegions.map((n) => n.id));
let treeRows = [],
  treeFocusId = null;
const masksFor = new Map(),
  activeMask = new Map();
for (const n of nodes) {
  if (n.isMask && n.visible) activeMask.set(n.parentId, n.id);
  else if (activeMask.has(n.parentId)) masksFor.set(n.id, activeMask.get(n.parentId));
}
const spacingEngine = window.HandoffSpacing.create(nodes, D.pages);
function getFrame(n) {
  return byId.get(n.frameId) || byId.get(n.regionId);
}
function ancestors(n) {
  const out = [];
  while (n?.parentId) {
    n = byId.get(n.parentId);
    if (n) out.push(n);
  }
  return out;
}
function box(n, relative) {
  const a = n.absoluteBoundingBox,
    b = relative?.absoluteBoundingBox || { x: 0, y: 0 };
  return { x: a.x - b.x, y: a.y - b.y, w: a.width, h: a.height };
}
function hex(c) {
  return (
    '#' +
    [c.r, c.g, c.b]
      .map((v) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  );
}
function rgba(c, a = 1) {
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${num(a)})`;
}
const px = (v) => num(v || 0) + 'px';
function copyButton(value, label = '复制') {
  return `<button class="copy" data-copy="${esc(value)}">${label}</button>`;
}
function toast(s) {
  $('toast').textContent = s;
  $('toast').classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('toast').classList.remove('show'), 2000);
}
async function copy(s) {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(s);
    else {
      const t = document.createElement('textarea');
      t.value = s;
      t.style.cssText = 'position:fixed;left:-9999px';
      document.body.append(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      if (!ok) throw Error('copy');
    }
    toast('已复制');
  } catch {
    toast('请选中内容，使用系统复制快捷键');
  }
}
function layerGlyph(n) {
  if (n.type === 'FRAME')
    return n.layoutMode === 'HORIZONTAL' ? '↔' : n.layoutMode === 'VERTICAL' ? '↕' : '▤';
  return (
    {
      SECTION: '▣',
      GROUP: '▧',
      COMPONENT: '◇',
      COMPONENT_SET: '❖',
      INSTANCE: '◆',
      TEXT: 'T',
      VECTOR: '⌁',
      BOOLEAN_OPERATION: '◈',
      RECTANGLE: '□',
      ELLIPSE: '○',
      LINE: '╱',
      SLICE: '⌗',
    }[n.type] || '◇'
  );
}
function boardThumbnail(n) {
  const r = byId.get(n.regionId),
    p = D.previews.find((p) => p.id === r.id),
    b = box(n, r),
    k = Math.min(42 / Math.max(1, b.w), 42 / Math.max(1, b.h));
  if (!p) return '<span class="board-thumb"></span>';
  const ox = (42 - b.w * k) / 2,
    oy = (42 - b.h * k) / 2;
  const image = (path, x, y, w, h) =>
    `<img loading="lazy" src="${esc(path)}" alt="" style="left:${(x - b.x) * k + ox}px;top:${(y - b.y) * k + oy}px;width:${w * k}px;height:${h * k}px">`;
  return (
    '<span class="board-thumb">' +
    image(
      p.path,
      p.offsetX ?? -(p.inset || 0),
      p.offsetY ?? -(p.inset || 0),
      p.displayWidth ?? p.pixelWidth / p.scale,
      p.displayHeight ?? p.pixelHeight / p.scale,
    ) +
    (p.patches || []).map((q) => image(q.path, q.x, q.y, q.width, q.height)).join('') +
    '</span>'
  );
}
function pageBoards() {
  return frames.filter((n) => regions.some((r) => r.id === n.regionId));
}
function renderNav() {
  const currentPage = D.pages.find((p) => p.id === pageId),
    path = new Set(ancestors(byId.get(selected)).map((n) => n.id));
  const stack = currentPage.regions
      .map((id) => ({ node: byId.get(id), level: 1 }))
      .filter((x) => x.node),
    seen = new Set();
  treeRows = [];
  // Figma lists topmost layers first; serialized children are in paint order.
  while (stack.length) {
    const item = stack.pop(),
      n = item.node;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    treeRows.push(item);
    if (expandedLayers.has(n.id))
      for (const child of layerChildren.get(n.id) || [])
        stack.push({ node: child, level: item.level + 1 });
  }
  if (!treeRows.some((x) => x.node.id === treeFocusId))
    treeFocusId = treeRows.some((x) => x.node.id === selected) ? selected : treeRows[0]?.node.id;
  const pages = D.pages
    .map(
      (p) =>
        `<button class="page-button ${p.id === pageId ? 'active' : ''}" data-page="${esc(p.id)}" ${p.id === pageId ? 'aria-current="page"' : ''}><span aria-hidden="true">▧</span>${esc(p.name)}</button>`,
    )
    .join('');
  const rows = treeRows
    .map(({ node: n, level }) => {
      const children = layerChildren.get(n.id) || [],
        open = expandedLayers.has(n.id);
      return `<div id="layer-${layerIndexes.get(n.id)}" class="layer-row ${selected === n.id ? 'active' : path.has(n.id) ? 'ancestor' : ''} ${n.visible === false ? 'is-hidden' : ''}" role="treeitem" aria-level="${level}" aria-selected="${selected === n.id}" ${children.length ? `aria-expanded="${open}"` : ''} tabindex="${treeFocusId === n.id ? '0' : '-1'}" data-layer="${esc(n.id)}" style="--level:${Math.min(level - 1, 12)}" title="${esc(n.name + ' · ' + n.type + ' · ' + n.id)}">${children.length ? `<button class="layer-disclosure" tabindex="-1" data-toggle-layer="${esc(n.id)}" aria-label="${open ? '收起' : '展开'} ${esc(n.name)}">${open ? '▾' : '▸'}</button>` : '<span class="layer-spacer"></span>'}<span class="layer-icon" aria-hidden="true">${layerGlyph(n)}</span><span class="layer-name">${esc(n.name)}</span><span class="layer-state">${n.locked === true ? '<span title="已锁定（只读）" aria-label="已锁定"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg></span>' : ''}${n.visible === false ? '<span title="图层或其父级已隐藏" aria-label="已隐藏"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8s2-4 7-4 7 4 7 4-2 4-7 4-7-4-7-4ZM2 2l12 12"/></svg></span>' : ''}</span></div>`;
    })
    .join('');
  const boards = pageBoards(),
    selectedFrame = getFrame(byId.get(selected));
  const cards = boards
    .map(
      (n) =>
        `<button class="board-card ${selectedFrame.id === n.id ? 'active' : ''}" data-focus="${esc(n.id)}" ${selectedFrame.id === n.id ? 'aria-current="true"' : ''}>${boardThumbnail(n)}<span class="board-info"><strong>${esc(n.name)}</strong><small>${esc(currentPage.name)} · ${num(n.width)} × ${num(n.height)}</small></span></button>`,
    )
    .join('');
  $('navigation').innerHTML =
    '<div class="page-list">' +
    pages +
    '</div>' +
    `<div class="directory-switch"><button data-directory="boards" class="${directory === 'boards' ? 'active' : ''}" aria-pressed="${directory === 'boards'}">画板 <small>${boards.length}</small></button><button data-directory="layers" class="${directory === 'layers' ? 'active' : ''}" aria-pressed="${directory === 'layers'}">图层目录</button></div><div class="board-list" ${directory === 'boards' ? '' : 'hidden'}>${cards}</div><div class="layer-tree" role="tree" aria-label="当前页面图层" ${directory === 'layers' ? '' : 'hidden'}>${rows}</div>`;
  $('pageCount').textContent =
    `${D.pages.length} 页面 · ${currentPage.regions.reduce((sum, id) => sum + (layerCounts.get(id) || 0), 0)} 图层`;
}
function revealLayer(id) {
  for (const parent of ancestors(byId.get(id))) expandedLayers.add(parent.id);
  treeFocusId = id;
}
function scrollLayer(id, focus = false) {
  const row = $('layer-' + layerIndexes.get(id));
  if (!row) return;
  if (focus) row.focus?.({ preventScroll: true });
  row.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}
function toggleLayer(id) {
  if (!(layerChildren.get(id) || []).length) return;
  if (expandedLayers.has(id)) expandedLayers.delete(id);
  else expandedLayers.add(id);
  treeFocusId = id;
  renderNav();
  scrollLayer(id, true);
}
function inspectLayer(id) {
  if ($('inspector').hidden) togglePanel('right');
  focusNode(id);
  panel();
  scrollLayer(id, true);
}
function renderScene() {
  $('scene').innerHTML = regions
    .map((r) => {
      const b = box(r),
        p = D.previews.find((p) => p.id === r.id);
      return `<div class="region" id="region-${r.id.replace(':', '-')}" data-region="${esc(r.id)}" style="left:${b.x - bounds.x + pad}px;top:${b.y - bounds.y + pad}px;width:${b.w}px;height:${b.h}px"><span class="region-label">${esc(r.name)} · ${num(b.x)}, ${num(b.y)}</span><div style="position:absolute;inset:0;overflow:hidden;pointer-events:none"><img style="position:absolute;left:${p.offsetX ?? -(p.inset || 0)}px;top:${p.offsetY ?? -(p.inset || 0)}px;width:${p.displayWidth ?? p.pixelWidth / p.scale}px;height:${p.displayHeight ?? p.pixelHeight / p.scale}px" src="${esc(p.path)}" alt="${esc(r.name + '原始设计稿')}" draggable="false"></div>${(p.patches || []).map((q) => `<div style="position:absolute;left:${q.x}px;top:${q.y}px;width:${q.width}px;height:${q.height}px;background:${q.background};pointer-events:none"><img src="${esc(q.path)}" alt="" draggable="false" style="display:block;width:100%;height:100%"></div>`).join('')}<svg data-overlay="${esc(r.id)}" aria-hidden="true"></svg></div>`;
    })
    .join('');
  resizeStage();
}
function resizeStage() {
  const w = bounds.right - bounds.x + pad * 2,
    h = bounds.bottom - bounds.y + pad * 2;
  $('scene').style.width = w + 'px';
  $('scene').style.height = h + 'px';
  $('scene').style.transform = `scale(${zoom})`;
  $('stage').style.width = Math.max(w * zoom, $('viewport').clientWidth) + 'px';
  $('stage').style.height = Math.max(h * zoom, $('viewport').clientHeight) + 'px';
  $('zoomValue').textContent = Math.round(zoom * 100) + '%';
  drawOverlay();
}
function setZoom(value, anchor) {
  const v = $('viewport'),
    old = zoom;
  const ax = anchor?.x ?? v.clientWidth / 2,
    ay = anchor?.y ?? v.clientHeight / 2;
  const x = (v.scrollLeft + ax) / old,
    y = (v.scrollTop + ay) / old;
  zoom = Math.max(0.08, Math.min(3, value));
  resizeStage();
  v.scrollLeft = Math.max(0, x * zoom - ax);
  v.scrollTop = Math.max(0, y * zoom - ay);
}
function focusNode(id) {
  const n = byId.get(id);
  if (!n) return;
  const p = D.pages.find((p) => p.regions.includes(n.regionId));
  if (p && p.id !== pageId) {
    usePage(p.id);
    renderScene();
  }
  focused = id;
  selected = id;
  revealLayer(id);
  hover = null;
  hitIds = [];
  const v = $('viewport'),
    b = box(n);
  zoom = Math.max(0.08, Math.min(1.2, (v.clientWidth - 90) / b.w));
  resizeStage();
  v.scrollLeft = Math.max(0, (b.x - bounds.x + pad) * zoom - (v.clientWidth - b.w * zoom) / 2);
  v.scrollTop = Math.max(0, (b.y - bounds.y + pad) * zoom - 45);
  $('crumb').textContent = byId.get(n.regionId).name + ' / ' + n.name;
  renderNav();
  scrollLayer(id);
  renderInspector();
  $('inspectPanel').scrollTop = 0;
  renderAssets();
  renderColors();
}
function overview() {
  focused = 'page';
  hover = null;
  hitIds = [];
  const v = $('viewport');
  zoom = Math.max(
    0.08,
    Math.min(
      (v.clientWidth - 36) / (bounds.right - bounds.x + pad * 2),
      (v.clientHeight - 36) / (bounds.bottom - bounds.y + pad * 2),
    ),
  );
  resizeStage();
  v.scrollLeft = 0;
  v.scrollTop = 0;
  $('crumb').textContent = D.pages.find((p) => p.id === pageId).name + ' / 全页';
  renderNav();
}
function select(id) {
  if (!byId.has(id)) return;
  const changed = selected !== id;
  selected = id;
  hover = null;
  revealLayer(id);
  renderNav();
  scrollLayer(id);
  renderInspector();
  if (changed) $('inspectPanel').scrollTop = 0;
  drawOverlay();
  renderAssets();
}
function placeLabel(x, y, w, h, occupied) {
  const gap = 3 / zoom,
    step = h + gap;
  const collides = (cx, cy) =>
    occupied.some(
      (b) =>
        cx - w / 2 - gap < b.x + b.w / 2 &&
        cx + w / 2 + gap > b.x - b.w / 2 &&
        cy - h / 2 - gap < b.y + b.h / 2 &&
        cy + h / 2 + gap > b.y - b.h / 2,
    );
  let point = { x, y };
  for (let i = 0; i < 18; i++) {
    const dy = i === 0 ? 0 : Math.ceil(i / 2) * step * (i % 2 ? 1 : -1);
    if (!collides(x, y + dy)) {
      point = { x, y: y + dy };
      break;
    }
  }
  occupied.push({ ...point, w, h });
  return point;
}
function measurementLine(l, r, occupied) {
  const origin = r.absoluteBoundingBox,
    x1 = l.from.x - origin.x,
    y1 = l.from.y - origin.y,
    x2 = l.to.x - origin.x,
    y2 = l.to.y - origin.y,
    len = Math.hypot(x2 - x1, y2 - y1);
  if (!len) return '';
  const ux = -(y2 - y1) / len,
    uy = (x2 - x1) / len,
    c = '#EE6723',
    cap = 3 / zoom,
    label = String(num(l.value)),
    w = (label.length * 8 + 12) / zoom,
    h = 21 / zoom;
  const desired = { x: (x1 + x2) / 2 + (ux * 12) / zoom, y: (y1 + y2) / 2 + (uy * 12) / zoom },
    placed = placeLabel(desired.x, desired.y, w, h, occupied),
    x = placed.x,
    y = placed.y;
  const leader =
    Math.abs(y - desired.y) > 1 / zoom
      ? `<path d="M${(x1 + x2) / 2} ${(y1 + y2) / 2}L${x} ${y}" stroke="${c}" stroke-opacity=".6" stroke-dasharray="${2 / zoom} ${2 / zoom}" stroke-width="${0.75 / zoom}" fill="none"/>`
      : '';
  return `<g class="spacing-measure" data-spacing-kind="${l.kind}">${leader}<path d="M${x1} ${y1}L${x2} ${y2}M${x1 - ux * cap} ${y1 - uy * cap}L${x1 + ux * cap} ${y1 + uy * cap}M${x2 - ux * cap} ${y2 - uy * cap}L${x2 + ux * cap} ${y2 + uy * cap}" stroke="${c}" stroke-width="${1 / zoom}" fill="none"/><rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${3 / zoom}" fill="${c}"/><text x="${x}" y="${y + 4 / zoom}" text-anchor="middle" fill="white" font-size="${12 / zoom}" font-family="sans-serif">${esc(label)}</text></g>`;
}
function spacingOverlay(n, r, occupied = []) {
  if (!annotations || !hover || hover === n.id) return '';
  const target = spacingEngine.between(n.id, hover);
  return target ? target.lines.map((l) => measurementLine(l, r, occupied)).join('') : '';
}
function dimensionsOverlay(n, r, occupied = []) {
  if (!annotations) return '';
  const t = n.absoluteTransform || [
      [1, 0, n.absoluteBoundingBox.x],
      [0, 1, n.absoluteBoundingBox.y],
    ],
    o = r.absoluteBoundingBox,
    point = (x, y) => ({
      x: t[0][0] * x + t[0][1] * y + t[0][2] - o.x,
      y: t[1][0] * x + t[1][1] * y + t[1][2] - o.y,
    });
  return [
    [point(n.width / 2, 0), 'W', n.width],
    [point(n.width, n.height / 2), 'H', n.height],
  ]
    .map(([p, axis, value]) => {
      const label = String(num(value)),
        w = (label.length * 7 + 8) / zoom,
        h = 20 / zoom,
        x = p.x + (axis === 'H' ? w / 2 + 3 / zoom : 0),
        y = p.y - (axis === 'W' ? 13 / zoom : 0),
        placed = placeLabel(x, y, w, h, occupied);
      return `<g data-dimension="${axis}"><rect x="${placed.x - w / 2}" y="${placed.y - h / 2}" width="${w}" height="${h}" rx="${2 / zoom}" fill="#EE6723"/><text x="${placed.x}" y="${placed.y + 4 / zoom}" text-anchor="middle" fill="white" font-family="sans-serif" font-size="${12 / zoom}">${esc(label)}</text></g>`;
    })
    .join('');
}
function fallbackCSS(n) {
  const lines = [`width: ${px(n.width)};`, `height: ${px(n.height)};`];
  const parent = byId.get(n.parentId);
  if (
    n.layoutPositioning === 'ABSOLUTE' ||
    (parent && !['HORIZONTAL', 'VERTICAL', 'GRID'].includes(parent.layoutMode))
  )
    lines.push('position: absolute;');
  const fills = Array.isArray(n.fills) ? n.fills.filter((p) => p.visible !== false) : [],
    solid = fills.find((p) => p.type === 'SOLID');
  if (solid && fills.every((p) => p.type === 'SOLID'))
    lines.push(
      `${n.type === 'TEXT' ? 'color' : 'background-color'}: ${(solid.opacity ?? 1) === 1 ? hex(solid.color) : rgba(solid.color, solid.opacity)};`,
    );
  if (n.opacity !== undefined && n.opacity !== 1) lines.push(`opacity: ${num(n.opacity)};`);
  const radii = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'].map(
    (k) => n[k] ?? n.cornerRadius ?? 0,
  );
  if (radii.some((x) => typeof x === 'number' && x !== 0))
    lines.push(
      `border-radius: ${(radii.every((x) => x === radii[0]) ? [radii[0]] : radii).map(px).join(' ')};`,
    );
  if (n.type === 'TEXT') {
    if (n.fontName && n.fontName !== 'MIXED')
      lines.push(`font-family: ${JSON.stringify(n.fontName.family)};`);
    if (typeof n.fontSize === 'number') lines.push(`font-size: ${px(n.fontSize)};`);
    if (typeof n.fontWeight === 'number') lines.push(`font-weight: ${n.fontWeight};`);
    if (n.lineHeight && n.lineHeight !== 'MIXED')
      lines.push(
        `line-height: ${n.lineHeight.unit === 'AUTO' ? 'normal' : n.lineHeight.unit === 'PERCENT' ? num(n.lineHeight.value / 100) : px(n.lineHeight.value)};`,
      );
    if (n.letterSpacing && n.letterSpacing !== 'MIXED')
      lines.push(
        `letter-spacing: ${n.letterSpacing.unit === 'PERCENT' ? num(n.letterSpacing.value / 100) + 'em' : px(n.letterSpacing.value)};`,
      );
    lines.push(`text-align: ${(n.textAlignHorizontal || 'LEFT').toLowerCase()};`);
  }
  if (['HORIZONTAL', 'VERTICAL'].includes(n.layoutMode))
    lines.push(
      'display: flex;',
      `flex-direction: ${n.layoutMode === 'VERTICAL' ? 'column' : 'row'};`,
      n.primaryAxisAlignItems === 'SPACE_BETWEEN'
        ? 'justify-content: space-between;'
        : `gap: ${px(n.itemSpacing)};`,
      `padding: ${px(n.paddingTop)} ${px(n.paddingRight)} ${px(n.paddingBottom)} ${px(n.paddingLeft)};`,
    );
  if (n.layoutMode === 'GRID') {
    lines.push(
      'display: grid;',
      `padding: ${px(n.paddingTop)} ${px(n.paddingRight)} ${px(n.paddingBottom)} ${px(n.paddingLeft)};`,
    );
    if (Number.isFinite(n.gridRowGap)) lines.push(`row-gap: ${px(n.gridRowGap)};`);
    if (Number.isFinite(n.gridColumnGap)) lines.push(`column-gap: ${px(n.gridColumnGap)};`);
    lines.push('/* Grid 轨道与单元格定位请参考 Figma 原生 CSS。 */');
  }
  const st = Array.isArray(n.strokes)
    ? n.strokes.find((p) => p.type === 'SOLID' && p.visible !== false)
    : null;
  if (st && typeof n.strokeWeight === 'number')
    lines.push(
      `border: ${px(n.strokeWeight)} solid ${rgba(st.color, st.opacity ?? 1)}; /* Figma ${n.strokeAlign} */`,
    );
  const shadow = (n.effects || []).filter(
    (e) => e.visible !== false && ['DROP_SHADOW', 'INNER_SHADOW'].includes(e.type),
  );
  if (shadow.length)
    lines.push(
      `box-shadow: ${shadow.map((e) => `${e.type === 'INNER_SHADOW' ? 'inset ' : ''}${px(e.offset.x)} ${px(e.offset.y)} ${px(e.radius)} ${px(e.spread)} ${rgba(e.color, e.color.a ?? 1)}`).join(', ')};`,
    );
  if (n.textSegments) lines.push('/* 混合文本的分段样式见设计数据。 */');
  if (fills.some((p) => p.type !== 'SOLID')) {
    const backgrounds = fills.map((p) =>
      p.type === 'GRADIENT_LINEAR'
        ? linearGradientCSS(p, n)
        : p.type === 'SOLID'
          ? `linear-gradient(${rgba(p.color, p.opacity ?? 1)}, ${rgba(p.color, p.opacity ?? 1)})`
          : null,
    );
    if (n.type !== 'TEXT' && backgrounds.every(Boolean))
      lines.push('background: ' + backgrounds.join(', ') + ';');
    else lines.push('/* 此填充暂不能完整推导为 CSS，请重新导出 Figma 原生 CSS 或参考切图。 */');
  }
  return lines.join('\n');
}
// A Plugin API gradientTransform maps normalized layer coordinates into
// gradient space; its first row defines the scalar t at each point. Project
// that field onto the CSS gradient line, including non-square sizes/offsets.
function linearGradientCSS(p, n) {
  const m = p.gradientTransform,
    w = n.width,
    h = n.height;
  if (
    !(w > 0 && h > 0) ||
    !Array.isArray(m) ||
    m.length !== 2 ||
    m.some((row) => !Array.isArray(row) || row.length !== 3 || !row.every(Number.isFinite)) ||
    !Array.isArray(p.gradientStops) ||
    !p.gradientStops.length
  )
    return null;
  const [[a, b, c], [d, e]] = m;
  if (Math.abs(a * e - b * d) < 1e-12) return null;
  const gx = a / w,
    gy = b / h,
    mag = Math.hypot(gx, gy);
  if (!mag) return null;
  const ux = gx / mag,
    uy = gy / mag,
    length = Math.abs(w * ux) + Math.abs(h * uy),
    center = a / 2 + b / 2 + c;
  const angle = ((Math.atan2(ux, -uy) * 180) / Math.PI + 360) % 360;
  const stops = [];
  for (const stop of p.gradientStops) {
    const color = stop.color;
    if (!color || ![color.r, color.g, color.b, stop.position].every(Number.isFinite)) return null;
    const alpha = (color.a ?? 1) * (p.opacity ?? 1);
    if (!Number.isFinite(alpha)) return null;
    stops.push(
      `${alpha === 1 ? hex(color) : rgba(color, alpha)} ${num(50 + ((stop.position - center) / (mag * length)) * 100)}%`,
    );
  }
  return `linear-gradient(${num(angle)}deg, ${stops.join(', ')})`;
}
function cssGroupFor(key) {
  if (
    /^(position|top|right|bottom|left|inset(?:-.+)?|z-index|transform(?:-.+)?|translate|rotate|scale)$/.test(
      key,
    )
  )
    return 'Position';
  if (
    /^(width|height|min-width|min-height|max-width|max-height|display|box-sizing|aspect-ratio|order|overflow(?:-.+)?|flex(?:-.+)?|grid(?:-.+)?|align-.+|justify-.+|place-.+|gap|row-gap|column-gap|padding(?:-.+)?|margin(?:-.+)?)$/.test(
      key,
    )
  )
    return 'Layout';
  return 'Style';
}
function cssData(n) {
  const groups = { Layout: [], Position: [], Style: [] },
    notes = [];
  const native = n.figmaCSS && typeof n.figmaCSS === 'object' && !Array.isArray(n.figmaCSS);
  if (native) {
    for (const [key, value] of Object.entries(n.figmaCSS))
      if (typeof value === 'string' && value.trim()) groups[cssGroupFor(key)].push([key, value]);
  } else
    for (const line of fallbackCSS(n).split('\n')) {
      if (line.startsWith('/*')) {
        notes.push(line.slice(2, -2).trim());
        continue;
      }
      const match = line.match(/^([a-z-]+):\s*(.*);(?:\s*\/\*.*\*\/)?$/);
      if (match) groups[cssGroupFor(match[1])].push([match[1], match[2]]);
    }
  return { groups, notes, native: !!native };
}
function cssText(entries) {
  return entries.map(([key, value]) => key + ': ' + value + ';').join('\n');
}
function css(n) {
  const data = cssData(n);
  return Object.entries(data.groups)
    .filter(([, entries]) => entries.length)
    .map(([label, entries]) => '/* ' + label + ' */\n' + cssText(entries))
    .join('\n\n');
}
function colors(n) {
  const paints = Array.isArray(n.fills) ? n.fills : [],
    out = [];
  for (const p of paints) {
    if (p.visible === false) continue;
    if (p.type === 'SOLID') out.push({ color: p.color, opacity: p.opacity ?? 1 });
    if (p.gradientStops)
      for (const s of p.gradientStops)
        out.push({ color: s.color, opacity: (s.color.a ?? 1) * (p.opacity ?? 1) });
  }
  if (n.textSegments)
    for (const s of n.textSegments)
      for (const p of s.fills || [])
        if (p.type === 'SOLID' && p.visible !== false)
          out.push({ color: p.color, opacity: p.opacity ?? 1 });
  const seen = new Set();
  return out.filter((p) => {
    const k = rgba(p.color, p.opacity);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
// Assets are already exported files. Reuse their bytes; never synthesize a
// format that was not produced by the Figma export job.
const assetsByNode = new Map(),
  assetIndexes = new Map(assets.map((a, i) => [a, i]));
for (const a of assets)
  if (['svg', 'png'].includes(String(a.format).toLowerCase()))
    for (const id of a.nodeIds || []) {
      if (!assetsByNode.has(id)) assetsByNode.set(id, []);
      assetsByNode.get(id).push(a);
    }
let exportChoice = null;
function exportContext(n) {
  for (const owner of n ? [n, ...ancestors(n)] : []) {
    const items = assetsByNode.get(owner.id);
    if (items?.length) return { owner, items };
  }
  return { owner: null, items: [] };
}
function assetFilename(a, owner) {
  const format = String(a.format).toLowerCase(),
    use = a.uses?.find((u) => u.nodeId === owner?.id);
  let name = String(use?.name || owner?.name || a.name || 'asset')
    .replace(new RegExp('\\.' + format + '$', 'i'), '')
    .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '-')
    .replace(/^[. ]+|[. ]+$/g, '');
  name = Array.from(name || 'asset')
    .slice(0, 60)
    .join('');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = 'asset-' + name;
  return name + '.' + format;
}
function preferredAsset(context) {
  if (!context.items.length) return null;
  const chosen = exportChoice?.ownerId === context.owner.id ? assets[exportChoice.index] : null;
  return context.items.includes(chosen)
    ? chosen
    : context.items.find((a) => a.format.toLowerCase() === 'svg') || context.items[0];
}
// file:// pages cannot read sibling images with fetch, and Chrome ignores
// <a download> for those URLs, so a normal click would preview the file.
// The package stores the original bytes in a sibling script; a blob URL
// then downloads them under the layer file name.
const downloadBytes = new Map();
function rememberDownload(path, b64) {
  downloadBytes.set(path, b64);
}
function mimeFor(path) {
  const format = String(path).split('.').pop().toLowerCase();
  if (format === 'svg') return 'image/svg+xml';
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  return 'application/octet-stream';
}
function decodeBase64(b64) {
  const binary = atob(b64),
    bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function saveBytes(bytes, filename, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function startDownload(path, filename) {
  const finish = (b64) => {
    saveBytes(decodeBase64(b64), filename, mimeFor(path));
    toast('已开始下载');
  };
  if (downloadBytes.has(path)) {
    try {
      finish(downloadBytes.get(path));
    } catch {
      toast('下载失败');
    }
    return;
  }
  const s = document.createElement('script');
  s.src = path + '.dl.js';
  s.onload = () => {
    if (!downloadBytes.has(path)) {
      toast('下载失败');
      return;
    }
    try {
      finish(downloadBytes.get(path));
    } catch {
      toast('下载失败');
    }
  };
  s.onerror = () => toast('无法下载，请用当前插件重新导出');
  (document.head || document.documentElement).append(s);
}
function saveLink(path, filename, label, extraClass = '') {
  return `<button type="button" class="export-save${extraClass ? ' ' + extraClass : ''}" data-save-path="${esc(path)}" data-save-name="${esc(filename)}">${esc(label)}</button>`;
}
function exportMeta(a) {
  const format = String(a.format || '').toUpperCase(),
    size = a.pixelWidth
      ? `${a.pixelWidth} × ${a.pixelHeight} px`
      : `${num(a.width)} × ${num(a.height)}`;
  return format + ' · ' + (a.scaleLabel || '矢量') + ' · ' + size;
}
function exportPanel(n) {
  const context = exportContext(n);
  if (!context.items.length) return '';
  const active = preferredAsset(context),
    body = context.items
      .map((a) => {
        const filename = assetFilename(a, context.owner),
          index = assetIndexes.get(a);
        return `<div class="export-file ${a === active ? 'active' : ''}"><a class="export-file-main" data-export-asset="${index}" href="${esc(a.path)}" download="${esc(filename)}" ${a === active ? 'aria-current="true"' : ''} title="${esc(filename)}"><span class="export-preview"><img src="${esc(a.path)}" alt=""></span><span class="export-file-info"><strong>${esc(filename)}</strong><small>${esc(exportMeta(a))}</small></span></a></div>`;
      })
      .join('');
  const filename = assetFilename(active, context.owner);
  return refSection(
    'Export',
    body +
      saveLink(
        active.path,
        filename,
        'Export ' + String(active.format || '').toUpperCase(),
        'export-action',
      ) +
      '<p class="export-hint">点击 Export 直接下载当前格式的原文件。</p>',
    'asset-export-section',
  );
}
function canvasExportSelection(hits) {
  const n = byId.get(hits[0]),
    owner = exportContext(n).owner;
  // A whole-board Export must not swallow every inspection click inside it.
  return owner && (owner.id === n.id || (owner.id !== n.frameId && owner.id !== n.regionId))
    ? owner.id
    : hits[0];
}
let nativeDownloadLink = null,
  lastCanvasPointer = null,
  altDownloadMode = false;
function clearNativeDownload() {
  nativeDownloadLink?.remove();
  nativeDownloadLink = null;
}
function updateNativeDownload(point) {
  if (
    !altDownloadMode ||
    !point ||
    panMode ||
    space ||
    drag ||
    point.region.isConnected === false
  ) {
    clearNativeDownload();
    return;
  }
  const context = exportContext(
      byId.get(pointerHits({ target: point.region, clientX: point.x, clientY: point.y })[0]),
    ),
    a = preferredAsset(context);
  if (!a) {
    clearNativeDownload();
    return;
  }
  if (!nativeDownloadLink) {
    nativeDownloadLink = document.createElement('a');
    nativeDownloadLink.className = 'native-download-target';
    nativeDownloadLink.tabIndex = -1;
  }
  nativeDownloadLink.dataset.nativeDownload = String(assetIndexes.get(a));
  nativeDownloadLink.href = a.path;
  nativeDownloadLink.download = assetFilename(a, context.owner);
  nativeDownloadLink.setAttribute('aria-label', '下载 ' + assetFilename(a, context.owner));
  // Keep the original trusted Alt-click on a real link. A synthetic click loses
  // native Save Link behavior for file:// pages in Chromium.
  if (nativeDownloadLink.parentElement !== point.region) point.region.append(nativeDownloadLink);
}
function handleCanvasClick(e) {
  if (suppressClick || space || panMode) return;
  hitIds = pointerHits(e);
  if (!hitIds.length) return;
  const id = canvasExportSelection(hitIds);
  if (!hitIds.includes(id)) hitIds.unshift(id);
  select(id);
  panel();
  const link = e.target.closest('[data-native-download]');
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (link) {
      const context = exportContext(byId.get(selected));
      exportChoice = { ownerId: context.owner.id, index: Number(link.dataset.nativeDownload) };
      toast('已请求下载原文件');
    } else toast('按住 Option / Alt 后点击右侧导出文件卡片下载');
  }
}
function activePaints(paints) {
  return Array.isArray(paints) ? paints.filter((p) => p.visible !== false) : [];
}
function bindingFor(n, path) {
  return (n.colorBindings || []).find((b) => b.path === path);
}
function paintColorUses(n) {
  const result = [];
  function add(p, path, label) {
    if (p.visible === false) return;
    const binding = bindingFor(n, path);
    function use(color, alpha, stop, pathOverride) {
      if (!color || ![color.r, color.g, color.b].every(Number.isFinite)) return;
      const info = bindingFor(n, pathOverride) || binding,
        alias = p.boundVariables?.color,
        variable =
          info?.variable ||
          (alias ? { id: alias.id, name: '未解析变量', collectionName: null } : null),
        style = info?.style;
      result.push({
        color,
        opacity: (color.a ?? 1) * alpha,
        variable,
        style,
        path: pathOverride || path,
        label: label + (stop === undefined ? '' : ' · ' + num(stop * 100) + '%'),
      });
    }
    if (p.type === 'SOLID') use(p.color, p.opacity ?? 1, undefined, path);
    for (let i = 0; i < (p.gradientStops || []).length; i++) {
      const stop = p.gradientStops[i];
      use(stop.color, p.opacity ?? 1, stop.position, path + '.gradientStops.' + i);
    }
  }
  for (const [field, label] of [
    ['fills', '填充'],
    ['strokes', '边框'],
  ])
    for (let i = 0; i < (Array.isArray(n[field]) ? n[field].length : 0); i++)
      add(n[field][i], field + '.' + i, label);
  for (let i = 0; i < (n.textSegments || []).length; i++)
    for (let j = 0; j < (n.textSegments[i].fills || []).length; j++)
      add(n.textSegments[i].fills[j], 'textSegments.' + i + '.fills.' + j, '文字');
  for (let i = 0; i < (n.effects || []).length; i++) {
    const e = n.effects[i];
    if (e.visible !== false && e.color)
      add(
        { type: 'SOLID', color: e.color, boundVariables: e.boundVariables },
        'effects.' + i,
        '阴影',
      );
  }
  return result;
}
const pagePalettes = new Map();
let visiblePalette = [];
function paletteForPage(id) {
  if (pagePalettes.has(id)) return pagePalettes.get(id);
  const p = D.pages.find((p) => p.id === id),
    roots = new Set(p?.regions || []),
    entries = new Map();
  for (const n of nodes) {
    if (!roots.has(n.regionId) || n.visible === false) continue;
    for (const c of paintColorUses(n)) {
      const token = c.variable || c.style,
        source = c.variable ? 'variable' : c.style ? 'style' : 'color',
        key =
          source +
          ':' +
          (token?.id || '') +
          ':' +
          (c.variable?.modeId || '') +
          ':' +
          rgba(c.color, c.opacity);
      if (!entries.has(key))
        entries.set(key, {
          ...c,
          key,
          source,
          name: token?.name || '页面用色',
          nodeIds: [],
          _seen: new Set(),
        });
      const entry = entries.get(key);
      if (!entry._seen.has(n.id)) {
        entry._seen.add(n.id);
        entry.nodeIds.push(n.id);
      }
    }
  }
  const list = [...entries.values()].sort(
    (a, b) =>
      ({ variable: 0, style: 1, color: 2 })[a.source] -
      { variable: 0, style: 1, color: 2 }[b.source],
  );
  pagePalettes.set(id, list);
  return list;
}
function renderColors() {
  if ($('colorPanel').hidden) return;
  const q = ($('colorSearch').value || '').trim().toLowerCase(),
    list = paletteForPage(pageId);
  visiblePalette = list.filter((c) =>
    [
      c.name,
      hex(c.color),
      c.variable?.collectionName,
      c.variable?.modeName,
      c.style?.name,
      c.variable?.cssName,
    ].some((v) =>
      String(v || '')
        .toLowerCase()
        .includes(q),
    ),
  );
  $('colorSummary').textContent =
    D.pages.find((p) => p.id === pageId).name +
    ' · ' +
    visiblePalette.length +
    ' 色 · 仅当前导出页面用色';
  $('colorList').innerHTML =
    visiblePalette
      .map(
        (c, i) =>
          `<article class="color-card"><span class="color-chip"><i style="background:${rgba(c.color, c.opacity)}"></i></span><div class="color-info"><strong>${esc(c.name)}${c.source !== 'color' ? `<span class="token-badge">${c.source === 'variable' ? '变量' : '样式'}</span>` : ''}</strong><small>${hex(c.color)} ${num(c.opacity * 100)}% · ${c.nodeIds.length} 个图层</small>${c.variable?.collectionName ? `<small>${esc(c.variable.collectionName)}${c.variable.modeName ? ' · ' + esc(c.variable.modeName) : ''}</small>` : ''}<div class="color-actions">${copyButton(c.opacity === 1 ? hex(c.color) : rgba(c.color, c.opacity), '复制颜色')}${c.variable?.cssName ? copyButton(c.variable.cssName, '复制变量') : ''}<button data-color-locate="${i}">定位图层</button></div></div></article>`,
      )
      .join('') ||
    '<p class="empty">当前页面没有符合条件的颜色。旧包可展示已有用色；命名变量及样式需用新版插件重新导出。</p>';
}
// MeaXure-style inspector. Detailed hierarchy and layout remain in design.json.
let displayUnit = 'px',
  colorMode = 0;
const unitLabels = { px: '网页 - px', pt: 'iOS - pt', dp: 'Android - dp/sp' };
const unitValue = (v, text = false) =>
  typeof v === 'number'
    ? num(v) + (displayUnit === 'dp' && text ? 'sp' : displayUnit)
    : v === 'MIXED'
      ? '混合'
      : '—';
const refIcons = {
  css: '<path d="M5 3h15l-2 17-6 2-6-2-1-6h4l.4 3 2.6.8 2.6-.8.3-3H7l-.3-4h9l.3-3H5.5z"/>',
  android:
    '<path d="m8 3 1.3 2h5.4L16 3l1 .6-1.3 2A6 6 0 0 1 18 10H6a6 6 0 0 1 2.3-4.4L7 3.6zM6 11h12v8H6zM3 11h2v7H3zm16 0h2v7h-2zM8 19h2v4H8zm6 0h2v4h-2z"/><circle cx="9" cy="8" r=".7" fill="#222"/><circle cx="15" cy="8" r=".7" fill="#222"/>',
  ios: '<path d="M16 2c.2 2-1.2 3.8-3.2 4.1C12.6 4.3 14 2.5 16 2Zm4 14c-1 2.3-2.7 5-4.5 5-1 0-1.6-.7-3-.7s-2.2.7-3.1.7C6.9 21 4 16.8 4 12.8 4 9.2 6.3 7 8.9 7c1.1 0 2.2.8 3.2.8s2.6-.9 3.8-.8c1.8.1 3.1.8 3.9 2-3.4 2-2.8 5.8.2 7Z"/>',
};
function refInput(value, caption = '', wide = false) {
  return `<label class="mx-control ${wide ? 'wide' : ''}" ${caption ? `data-label="${esc(caption)}"` : ''}><input readonly type="text" value="${esc(value)}" aria-label="${esc(caption || value)}"></label>`;
}
function refItem(label, fields) {
  return `<div class="mx-item"${label ? ` data-label="${esc(label + ':')}">` : '>'}<div class="mx-fields">${fields}</div></div>`;
}
function refSingle(label, value) {
  return refItem(label, refInput(value) + '<label class="mx-control"></label>');
}
function refSection(title, body, kind = '') {
  return `<section class="mx-section ${kind}"><h3>${esc(title)}</h3><div class="mx-context">${body}</div></section>`;
}
function colorFormats(color, alpha) {
  const a = alpha ?? 1;
  return [
    hex(color) + ' ' + num(a * 100) + '%',
    rgba(color, a),
    '#' +
      Math.round(a * 255)
        .toString(16)
        .padStart(2, '0')
        .toUpperCase() +
      hex(color).slice(1),
  ];
}
function refColor(color, alpha = 1, name = '') {
  const values = colorFormats(color, alpha);
  return `<div class="mx-color" ${name ? `data-name="${esc(name)}"` : ''}><button class="mx-swatch" type="button" data-color-values="${esc(JSON.stringify(values))}" title="切换颜色格式" aria-label="切换颜色格式"><i style="background:${rgba(color, alpha)}"></i></button><input readonly type="text" value="${esc(values[colorMode])}" aria-label="颜色"></div>`;
}
function colorName(n, path) {
  const b = bindingFor(n, path);
  return b?.variable?.name || b?.style?.name || '';
}
function refPaint(n, p, path) {
  if (p.type === 'SOLID' && p.color)
    return refItem(
      '颜色',
      refColor(p.color, (p.opacity ?? 1) * (p.color.a ?? 1), colorName(n, path)),
    );
  if (p.gradientStops?.length)
    return refItem(
      '渐变',
      '<div class="mx-gradient">' +
        p.gradientStops
          .map((s, i) =>
            refColor(
              s.color,
              (s.color.a ?? 1) * (p.opacity ?? 1),
              colorName(n, path + '.gradientStops.' + i),
            ),
          )
          .join('') +
        '</div>',
    );
  if (p.type === 'IMAGE')
    return refItem(
      '图片',
      refInput(
        { FILL: '填充', FIT: '适应', CROP: '裁剪', TILE: '平铺' }[p.scaleMode] ||
          p.scaleMode ||
          '图片',
      ),
    );
  return '';
}
function fillsPanel(n) {
  const content = activePaints(n.fills)
    .map((p) => refPaint(n, p, 'fills.' + n.fills.indexOf(p)))
    .filter(Boolean)
    .join('');
  return content ? refSection('填充', content) : '';
}
function bordersPanel(n) {
  const list = activePaints(n.strokes);
  if (!list.length) return '';
  const width =
    typeof n.strokeWeight === 'number'
      ? unitValue(n.strokeWeight)
      : ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight']
          .map((k) => unitValue(n[k]))
          .join(' ');
  return refSection(
    '边框',
    list
      .map(
        (p) =>
          '<div class="mx-items-group"><h4>' +
          esc(
            { INSIDE: '内边框', OUTSIDE: '外边框', CENTER: '居中边框' }[n.strokeAlign] || '边框',
          ) +
          '</h4>' +
          refSingle('粗细', width) +
          refPaint(n, p, 'strokes.' + n.strokes.indexOf(p)) +
          '</div>',
      )
      .join(''),
  );
}
function fontMetric(value, n) {
  if (typeof value === 'number') return unitValue(value, true);
  if (!value || value === 'MIXED') return '混合';
  if (value.unit === 'AUTO') return '自动';
  if (value.unit === 'PERCENT') return num(value.value) + '%';
  return unitValue(value.value, true);
}
function fontsPanel(n) {
  if (n.type !== 'TEXT') return '';
  const family =
    n.fontName && typeof n.fontName === 'object'
      ? n.fontName.family + (n.fontName.style ? ' ' + n.fontName.style : '')
      : '混合';
  return refSection(
    '字体',
    refItem('字体', refInput(family)) +
      refItem(
        '颜色',
        colors(n)
          .map((p) => refColor(p.color, p.opacity))
          .join(''),
      ) +
      refSingle('字号', unitValue(n.fontSize, true)) +
      refItem(
        '间距',
        refInput(fontMetric(n.letterSpacing, n), '字距') +
          refInput(fontMetric(n.lineHeight, n), '行距'),
      ) +
      `<div class="mx-item"><label class="mx-control" data-label="内容"><textarea readonly rows="2" aria-label="文字内容">${esc(n.characters)}</textarea></label></div>`,
  );
}
function shadowsPanel(n) {
  const list = (Array.isArray(n.effects) ? n.effects : []).filter((e) => e.visible !== false);
  if (!list.length) return '';
  const title = list.some((e) => e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW')
    ? '阴影'
    : '模糊';
  return refSection(
    title,
    list
      .map((e) => {
        let body =
          '<h4>' +
          esc(
            {
              DROP_SHADOW: '外阴影',
              INNER_SHADOW: '内阴影',
              LAYER_BLUR: '图层模糊',
              BACKGROUND_BLUR: '背景模糊',
            }[e.type] || e.type,
          ) +
          '</h4>';
        if (e.offset)
          body += refItem(
            '偏移',
            refInput(unitValue(e.offset.x), 'X') + refInput(unitValue(e.offset.y), 'Y'),
          );
        body += refItem(
          '效果',
          refInput(unitValue(e.radius), '模糊') +
            (e.spread === undefined
              ? '<label class="mx-control"></label>'
              : refInput(unitValue(e.spread), '扩散')),
        );
        if (e.color) body += refItem('颜色', refColor(e.color, e.color.a ?? 1));
        return '<div class="mx-items-group">' + body + '</div>';
      })
      .join(''),
  );
}
function templateCode(n, type) {
  if (type === 'css') return cssText(Object.values(cssData(n).groups).flat());
  const fill = activePaints(n.fills),
    solid = fill.length === 1 && fill[0].type === 'SOLID' ? fill[0] : null,
    b = box(n, getFrame(n)),
    r = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'].map(
      (k) => n[k] ?? n.cornerRadius,
    ),
    simpleRadius = r.every((v) => v === r[0]) && Number.isFinite(r[0]);
  const color = (p) => colorFormats(p.color, (p.opacity ?? 1) * (p.color.a ?? 1))[2],
    escapeXML = (v) =>
      String(v ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
      );
  if (type === 'android') {
    const tag = n.type === 'TEXT' ? 'TextView' : 'View',
      lines = [
        `<${tag} xmlns:android="http://schemas.android.com/apk/res/android"`,
        `    android:layout_width="${num(n.width)}dp"`,
        `    android:layout_height="${num(n.height)}dp"`,
      ];
    if (n.type === 'TEXT') {
      lines.push(`    android:text="${escapeXML(n.characters)}"`);
      if (Number.isFinite(n.fontSize)) lines.push(`    android:textSize="${num(n.fontSize)}sp"`);
      if (solid) lines.push(`    android:textColor="${color(solid)}"`);
    } else if (solid) lines.push(`    android:background="${color(solid)}"`);
    if (typeof n.opacity === 'number' && n.opacity !== 1)
      lines.push(`    android:alpha="${num(n.opacity)}"`);
    lines.push('/>');
    if (
      fill.length > 1 ||
      activePaints(n.strokes).length ||
      n.effects?.length ||
      (simpleRadius && r[0] > 0)
    )
      lines.push('<!-- 圆角、描边与复杂效果需另配 Drawable；完整属性见设计数据。 -->');
    return lines.join('\n');
  }
  const name = n.type === 'TEXT' ? 'label' : 'view',
    className = n.type === 'TEXT' ? 'UILabel' : 'UIView',
    lines = [
      `${className} *${name} = [[${className} alloc] init];`,
      `${name}.frame = CGRectMake(${num(b.x)}, ${num(b.y)}, ${num(n.width)}, ${num(n.height)});`,
    ],
    objcColor = (p) =>
      `[UIColor colorWithRed:${num(p.color.r)} green:${num(p.color.g)} blue:${num(p.color.b)} alpha:${num((p.opacity ?? 1) * (p.color.a ?? 1))}]`;
  if (n.type === 'TEXT') {
    lines.push(`label.text = @${JSON.stringify(String(n.characters || ''))};`);
    if (Number.isFinite(n.fontSize))
      lines.push(`label.font = [UIFont systemFontOfSize:${num(n.fontSize)}];`);
    if (solid) lines.push(`label.textColor = ${objcColor(solid)};`);
  } else if (solid) lines.push(`view.backgroundColor = ${objcColor(solid)};`);
  if (simpleRadius) lines.push(`${name}.layer.cornerRadius = ${num(r[0])};`);
  if (typeof n.opacity === 'number') lines.push(`${name}.alpha = ${num(n.opacity)};`);
  if (fill.length > 1 || activePaints(n.strokes).length || n.effects?.length)
    lines.push('// 描边、多重填充和阴影按设计数据补充。');
  return lines.join('\n');
}
function cssPanel(n) {
  if (!Object.values(cssData(n).groups).some((entries) => entries.length)) return '';
  const type = ['css', 'android', 'ios'].includes(codeTemplate) ? codeTemplate : 'css',
    code = templateCode(n, type),
    tabs = ['css', 'android', 'ios']
      .map(
        (t) =>
          `<button data-code-template="${t}" class="${t === type ? 'active' : ''}" role="tab" aria-selected="${t === type}" title="${t === 'ios' ? 'iOS' : t.toUpperCase()}" aria-label="${t === 'ios' ? 'iOS' : t.toUpperCase()}"><svg viewBox="0 0 24 24" aria-hidden="true">${refIcons[t]}</svg></button>`,
      )
      .join('');
  return `<section class="mx-section css-section"><h3>代码模板<button class="mx-copy" data-copy="${esc(code)}" aria-label="复制代码" title="复制代码">⧉</button></h3><div class="mx-code-tabs" role="tablist" aria-label="代码语言">${tabs}</div><div class="mx-code"><textarea readonly spellcheck="false" rows="${Math.min(24, Math.max(4, code.split('\n').length + 1))}" aria-label="${type.toUpperCase()} 代码">${esc(code)}</textarea></div></section>`;
}
function renderInspector() {
  const n = byId.get(selected),
    b = box(n, getFrame(n)),
    radii = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'].map(
      (k) => n[k] ?? n.cornerRadius,
    ),
    hasRadius = radii.some(Number.isFinite);
  let properties =
    refItem('位置', refInput(unitValue(b.x), 'X') + refInput(unitValue(b.y), 'Y')) +
    refItem('大小', refInput(unitValue(n.width), '宽度') + refInput(unitValue(n.height), '高度')) +
    refSingle('不透明度', num((n.opacity ?? 1) * 100) + '%');
  if (hasRadius)
    properties += refSingle(
      '圆角',
      radii.every((v) => v === radii[0])
        ? unitValue(radii[0])
        : radii.map((v) => unitValue(v)).join(' '),
    );
  $('inspectPanel').innerHTML =
    `<h2 class="mx-node-name">${esc(n.name)}</h2>` +
    refSection('属性', properties) +
    fillsPanel(n) +
    bordersPanel(n) +
    fontsPanel(n) +
    shadowsPanel(n) +
    cssPanel(n);
  const dock = $('exportDock');
  if (dock) {
    dock.innerHTML = exportPanel(n);
    dock.hidden = !dock.innerHTML;
  }
  $('unitLabel').textContent = unitLabels[displayUnit];
}

function polygon(n, r) {
  const t = n.absoluteTransform,
    o = r.absoluteBoundingBox;
  if (!t) {
    const b = box(n, r);
    return `${b.x},${b.y} ${b.x + b.w},${b.y} ${b.x + b.w},${b.y + b.h} ${b.x},${b.y + b.h}`;
  }
  return [
    [0, 0],
    [n.width, 0],
    [n.width, n.height],
    [0, n.height],
  ]
    .map(
      ([x, y]) =>
        `${t[0][0] * x + t[0][1] * y + t[0][2] - o.x},${t[1][0] * x + t[1][1] * y + t[1][2] - o.y}`,
    )
    .join(' ');
}
function hoverGuides(h, r) {
  if (!annotations) return '';
  const f = getFrame(h),
    t = f.absoluteTransform || [
      [1, 0, f.absoluteBoundingBox.x],
      [0, 1, f.absoluteBoundingBox.y],
    ],
    inv = window.HandoffSpacing.inverse(t);
  if (!inv) return '';
  const b = window.HandoffSpacing.rect(h, inv),
    o = r.absoluteBoundingBox,
    p = (x, y) => ({
      x: t[0][0] * x + t[0][1] * y + t[0][2] - o.x,
      y: t[1][0] * x + t[1][1] * y + t[1][2] - o.y,
    }),
    lines = [];
  for (const x of [b.x, b.right]) if (x >= 0 && x <= f.width) lines.push([p(x, 0), p(x, f.height)]);
  for (const y of [b.y, b.bottom])
    if (y >= 0 && y <= f.height) lines.push([p(0, y), p(f.width, y)]);
  return (
    `<g data-hover-guides="${esc(h.id)}" stroke="#419bf9" stroke-width="${1 / zoom}" stroke-dasharray="${3 / zoom} ${2 / zoom}" fill="none">` +
    lines.map(([a, b]) => `<path d="M${a.x} ${a.y}L${b.x} ${b.y}"/>`).join('') +
    '</g>'
  );
}
function drawOverlay() {
  if (!$('scene').innerHTML) return;
  const n = byId.get(selected),
    sw = 1 / zoom;
  document.querySelectorAll('[data-overlay]').forEach((svg) => {
    const r = byId.get(svg.dataset.overlay),
      h = hover && hover !== selected ? byId.get(hover) : null;
    let s = '';
    if (h && h.regionId === r.id)
      s +=
        hoverGuides(h, r) +
        `<polygon data-hover-outline points="${polygon(h, r)}" stroke="#419bf9" fill="none" stroke-width="${sw}"/>`;
    if (n.regionId === r.id) {
      const labels = [],
        points = polygon(n, r)
          .split(' ')
          .map((pair) => pair.split(',').map(Number)),
        comparing = h && spacingEngine.between(n.id, h.id);
      s +=
        `<polygon data-selected-outline points="${polygon(n, r)}" stroke="#EE6723" fill="none" stroke-width="${sw}"/>` +
        points
          .map(
            ([x, y]) =>
              `<circle cx="${x}" cy="${y}" r="${2 / zoom}" fill="white" stroke="#EE6723" stroke-width="${sw}"/>`,
          )
          .join('');
      s += comparing ? spacingOverlay(n, r, labels) : dimensionsOverlay(n, r, labels);
    }
    svg.innerHTML = s;
  });
}
function contains(n, x, y) {
  const t = n.absoluteTransform;
  if (!t) {
    const b = n.absoluteBoundingBox;
    return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
  }
  const dx = x - t[0][2],
    dy = y - t[1][2],
    det = t[0][0] * t[1][1] - t[0][1] * t[1][0];
  if (Math.abs(det) < 1e-9) return false;
  const lx = (t[1][1] * dx - t[0][1] * dy) / det,
    ly = (-t[1][0] * dx + t[0][0] * dy) / det;
  return lx >= 0 && ly >= 0 && lx <= n.width && ly <= n.height;
}
function hit(x, y, regionId) {
  const ns = regionNodes.get(regionId),
    hits = [];
  for (let i = ns.length - 1; i >= 0; i--) {
    const n = ns[i];
    if (n.isMask || n.opacity === 0 || !n.width || !n.height || !contains(n, x, y)) continue;
    const chain = [n, ...ancestors(n)];
    if (
      chain.some(
        (a) =>
          a.opacity === 0 ||
          (a.id !== n.id && a.clipsContent && !contains(a, x, y)) ||
          (masksFor.has(a.id) && !contains(byId.get(masksFor.get(a.id)), x, y)),
      )
    )
      continue;
    hits.push(n.id);
  }
  return hits;
}
function pointerHits(e) {
  const target = e.target.closest('[data-region]');
  if (!target) return [];
  const r = byId.get(target.dataset.region),
    b = target.getBoundingClientRect();
  return hit(
    (e.clientX - b.left) / zoom + r.absoluteBoundingBox.x,
    (e.clientY - b.top) / zoom + r.absoluteBoundingBox.y,
    r.id,
  );
}
function assetItems() {
  const n = byId.get(selected),
    f = getFrame(n),
    scope = $('assetScope').value || 'page',
    q = ($('assetSearch').value || '').trim().toLowerCase(),
    pageRoots = new Set(regions.map((r) => r.id));
  return assets.filter(
    (a) =>
      a.nodeIds.some((id) => {
        const x = byId.get(id);
        return (
          x &&
          (scope === 'all' ||
            (scope === 'page'
              ? pageRoots.has(x.regionId)
              : f.depth === 0
                ? x.regionId === f.id
                : x.frameId === f.id))
        );
      }) &&
      (assetFilter === 'all' || a.format === assetFilter) &&
      (!q ||
        a.name.toLowerCase().includes(q) ||
        a.nodeIds.some((id) => id.toLowerCase().includes(q))),
  );
}
function renderAssets() {
  if ($('assetPanel').hidden) return;
  const list = assetItems(),
    f = getFrame(byId.get(selected)),
    scope = $('assetScope').value || 'page';
  $('assetSummary').textContent =
    (scope === 'all'
      ? '全部页面'
      : scope === 'page'
        ? D.pages.find((p) => p.id === pageId).name
        : f.name) +
    ' · ' +
    list.length +
    ' 项（已去重）';
  $('assetList').innerHTML =
    list
      .map((a) => {
        const id =
          a.nodeIds.find((id) => byId.get(id)?.frameId === f.id) ||
          a.nodeIds.find((id) => regions.some((r) => r.id === byId.get(id)?.regionId)) ||
          a.nodeIds[0];
        return `<article class="asset-card ${a.nodeIds.includes(selected) ? 'active' : ''}"><button class="asset-preview" data-locate="${esc(id)}" aria-label="定位 ${esc(a.name)}"><img loading="lazy" src="${esc(a.path)}" alt=""></button><div class="asset-info"><strong>${esc(a.name)}</strong><p>${a.format.toUpperCase()} · ${num(a.width)} × ${num(a.height)} · ${esc(a.scaleLabel || '矢量')}</p>${a.pixelWidth ? `<p>文件 ${a.pixelWidth} × ${a.pixelHeight} px</p>` : ''}${a.nodeIds.length > 1 ? `<p>${a.nodeIds.length} 处共享</p>` : ''}<div class="asset-actions"><button data-locate="${esc(id)}">定位图层</button>${saveLink(a.path, assetFilename(a, byId.get(id)), '下载')}</div></div></article>`;
      })
      .join('') || '<p class="empty">当前筛选没有独立切图。可切换范围或 SVG / PNG 格式查看。</p>';
}
function setLibrary(which) {
  library = which;
  if ($('sidebar').hidden) togglePanel('left');
  for (const [name, tab, body] of [
    ['pages', 'pagesTab', 'pagePanel'],
    ['asset', 'assetTab', 'assetPanel'],
    ['colors', 'colorsTab', 'colorPanel'],
  ]) {
    $(body).hidden = which !== name;
    $(tab).classList.toggle('active', which === name);
    $(tab).setAttribute('aria-selected', String(which === name));
  }
  renderAssets();
  renderColors();
}
function locateNode(id) {
  const n = byId.get(id);
  if (!n) return;
  focusNode(n.frameId);
  select(n.id);
  if ($('inspector').hidden) togglePanel('right');
  const v = $('viewport');
  v.scrollTop = Math.max(0, (n.absoluteBoundingBox.y - bounds.y + pad) * zoom - v.clientHeight / 3);
}
$('navigation').addEventListener('click', (e) => {
  const d = e.target.closest('[data-directory]');
  if (d) {
    directory = d.dataset.directory;
    renderNav();
    return;
  }
  const f = e.target.closest('[data-focus]');
  if (f) {
    focusNode(f.dataset.focus);
    return;
  }
  const toggle = e.target.closest('[data-toggle-layer]');
  if (toggle) {
    toggleLayer(toggle.dataset.toggleLayer);
    return;
  }
  const layer = e.target.closest('[data-layer]');
  if (layer) {
    inspectLayer(layer.dataset.layer);
    return;
  }
  const p = e.target.closest('[data-page]');
  if (p) {
    usePage(p.dataset.page);
    selected = regions[0].id;
    revealLayer(selected);
    renderScene();
    overview();
    renderInspector();
    renderAssets();
    renderColors();
  }
});
$('navigation').addEventListener('keydown', (e) => {
  const row = e.target.closest('[data-layer]');
  if (!row) return;
  const id = row.dataset.layer,
    index = treeRows.findIndex((x) => x.node.id === id),
    children = layerChildren.get(id) || [];
  let next = null;
  if (e.key === 'ArrowDown') next = treeRows[Math.min(index + 1, treeRows.length - 1)]?.node.id;
  else if (e.key === 'ArrowUp') next = treeRows[Math.max(0, index - 1)]?.node.id;
  else if (e.key === 'Home') next = treeRows[0]?.node.id;
  else if (e.key === 'End') next = treeRows[treeRows.length - 1]?.node.id;
  else if (e.key === 'ArrowRight') {
    if (children.length && !expandedLayers.has(id)) toggleLayer(id);
    else if (children.length) next = treeRows[index + 1]?.node.id;
  } else if (e.key === 'ArrowLeft') {
    if (children.length && expandedLayers.has(id)) toggleLayer(id);
    else next = byId.get(id)?.parentId;
  } else if (e.key === 'Enter' || e.key === ' ') {
    inspectLayer(id);
  } else return;
  e.preventDefault();
  e.stopPropagation();
  if (next) {
    treeFocusId = next;
    renderNav();
    scrollLayer(next, true);
  }
});
function handleExportClick(e) {
  const save = e.target.closest('[data-save-path]');
  if (save) {
    e.preventDefault();
    startDownload(save.dataset.savePath, save.dataset.saveName);
    return;
  }
  const file = e.target.closest('[data-export-asset]');
  if (!file) return;
  const context = exportContext(byId.get(selected)),
    index = Number(file.dataset.exportAsset),
    asset = assets[index];
  if (!context.items.includes(asset)) {
    e.preventDefault();
    return;
  }
  exportChoice = { ownerId: context.owner.id, index };
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    document.querySelectorAll('[data-export-asset]').forEach((link) => {
      const active = Number(link.dataset.exportAsset) === index;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
    toast('已请求下载原文件');
  } else {
    e.preventDefault();
    const top = $('inspectPanel').scrollTop;
    renderInspector();
    $('inspectPanel').scrollTop = top;
  }
}
$('exportDock').addEventListener('click', handleExportClick);
$('inspectPanel').addEventListener('click', (e) => {
  const swatch = e.target.closest('[data-color-values]');
  if (swatch) {
    colorMode = (colorMode + 1) % 3;
    const top = $('inspectPanel').scrollTop;
    renderInspector();
    $('inspectPanel').scrollTop = top;
    return;
  }
  const template = e.target.closest('[data-code-template]');
  if (template) {
    codeTemplate = template.dataset.codeTemplate;
    const top = $('inspectPanel').scrollTop;
    renderInspector();
    $('inspectPanel').scrollTop = top;
    return;
  }
  const c = e.target.closest('[data-copy]');
  if (c) copy(c.dataset.copy);
  const f = e.target.closest('[data-focus]');
  if (f) focusNode(f.dataset.focus);
  const s = e.target.closest('[data-select]');
  if (s) select(s.dataset.select);
});
function panel() {
  if ($('inspector').hidden) togglePanel('right');
}
$('unitSelect').onchange = (e) => {
  displayUnit = e.target.value;
  renderInspector();
};
$('inspectPanel').addEventListener('dblclick', (e) => {
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) e.target.select();
});
$('pagesTab').onclick = () => setLibrary('pages');
$('assetTab').onclick = () => setLibrary('asset');
$('colorsTab').onclick = () => setLibrary('colors');
$('assetCount').textContent = assets.length;
const bundleLink = $('assetBundle');
if (bundleLink) {
  bundleLink.hidden = !D.assetBundle;
  if (D.assetBundle) {
    bundleLink.href = D.assetBundle;
    bundleLink.download = '切图.zip';
  }
}
$('assetScope').onchange = renderAssets;
$('assetSearch').oninput = renderAssets;
$('colorSearch').oninput = renderColors;
document.querySelectorAll('[data-filter]').forEach(
  (b) =>
    (b.onclick = () => {
      assetFilter = b.dataset.filter;
      document
        .querySelectorAll('[data-filter]')
        .forEach((t) => t.classList.toggle('active', t === b));
      renderAssets();
    }),
);
$('assetList').addEventListener('click', (e) => {
  const save = e.target.closest('[data-save-path]');
  if (save) {
    startDownload(save.dataset.savePath, save.dataset.saveName);
    return;
  }
  const b = e.target.closest('[data-locate]');
  if (b) locateNode(b.dataset.locate);
});
$('colorList').addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]');
  if (c) {
    copy(c.dataset.copy);
    return;
  }
  const b = e.target.closest('[data-color-locate]');
  if (b) {
    const color = visiblePalette[Number(b.dataset.colorLocate)];
    if (color) {
      const index = color.nodeIds.indexOf(selected);
      locateNode(color.nodeIds[(index + 1) % color.nodeIds.length]);
    }
  }
});
$('annotations').onclick = () => {
  annotations = !annotations;
  $('annotations').classList.toggle('active', annotations);
  $('annotations').setAttribute('aria-pressed', String(annotations));
  drawOverlay();
};
// Keep both switches outside the panels, so a hidden panel can always reopen.
function togglePanel(side) {
  const panelId = side === 'left' ? 'sidebar' : 'inspector',
    buttonId = side === 'left' ? 'toggleSidebar' : 'toggleInspector';
  const v = $('viewport'),
    center = {
      x: (v.scrollLeft + v.clientWidth / 2) / zoom,
      y: (v.scrollTop + v.clientHeight / 2) / zoom,
    };
  const collapsed = !$(panelId).hidden;
  $(panelId).hidden = collapsed;
  $('workspace').classList.toggle(side + '-collapsed', collapsed);
  const label = (collapsed ? '展开' : '收起') + (side === 'left' ? '左侧目录' : '右侧标注面板');
  $(buttonId).setAttribute('aria-expanded', String(!collapsed));
  $(buttonId).setAttribute('aria-label', label);
  $(buttonId).title = label;
  resizeStage();
  v.scrollLeft = Math.max(0, center.x * zoom - v.clientWidth / 2);
  v.scrollTop = Math.max(0, center.y * zoom - v.clientHeight / 2);
}
$('toggleSidebar').onclick = () => togglePanel('left');
$('toggleInspector').onclick = () => togglePanel('right');
$('overview').onclick = overview;
$('fit').onclick = () => focusNode(focused === 'page' ? byId.get(selected).frameId : focused);
$('zoomIn').onclick = () => setZoom(zoom * 1.2);
$('zoomOut').onclick = () => setZoom(zoom / 1.2);
$('zoomValue').onclick = () => setZoom(1);
$('pan').onclick = () => {
  panMode = !panMode;
  clearNativeDownload();
  $('pan').classList.toggle('active', panMode);
  $('pan').setAttribute('aria-pressed', panMode);
  $('viewport').classList.toggle('pan-mode', panMode || space);
};
$('viewport').addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = $('viewport').getBoundingClientRect();
      setZoom(zoom * (e.deltaY > 0 ? 0.9 : 1.1), { x: e.clientX - r.left, y: e.clientY - r.top });
    }
  },
  { passive: false },
);
$('viewport').addEventListener('pointerdown', (e) => {
  if (space || panMode || e.button === 1) {
    e.preventDefault();
    drag = {
      x: e.clientX,
      y: e.clientY,
      left: $('viewport').scrollLeft,
      top: $('viewport').scrollTop,
    };
    $('viewport').setPointerCapture(e.pointerId);
    $('viewport').classList.add('dragging');
  }
});
$('viewport').addEventListener('pointermove', (e) => {
  const region = e.target.closest('[data-region]');
  lastCanvasPointer = region ? { region, x: e.clientX, y: e.clientY } : null;
  altDownloadMode = e.altKey === true && !e.ctrlKey && !e.metaKey;
  updateNativeDownload(lastCanvasPointer);
  if (drag) {
    $('viewport').scrollLeft = drag.left - (e.clientX - drag.x);
    $('viewport').scrollTop = drag.top - (e.clientY - drag.y);
    return;
  }
  if (space || panMode) return;
  const hits = pointerHits(e),
    id = hits[0] || null;
  if (hover !== id) {
    hover = id;
    drawOverlay();
    $('status').textContent = id
      ? `${byId.get(id).name} · ${num(byId.get(id).width)} × ${num(byId.get(id).height)} px`
      : '点击元素查看尺寸与坐标';
  }
});
$('viewport').addEventListener('pointerup', () => {
  suppressClick = !!drag;
  drag = null;
  $('viewport').classList.remove('dragging');
  setTimeout(() => (suppressClick = false), 0);
});
$('viewport').addEventListener('pointercancel', () => {
  drag = null;
  $('viewport').classList.remove('dragging');
});
$('viewport').addEventListener('click', handleCanvasClick);
$('viewport').addEventListener('pointerleave', () => {
  lastCanvasPointer = null;
  clearNativeDownload();
  hover = null;
  drawOverlay();
});
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    altDownloadMode = false;
    clearNativeDownload();
  }
  if (e.key === 'Alt' && !e.ctrlKey && !e.metaKey) {
    altDownloadMode = true;
    updateNativeDownload(lastCanvasPointer);
  }
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(e.target.tagName)) return;
  if (e.code === 'Space') {
    e.preventDefault();
    space = true;
    $('viewport').classList.add('pan-mode');
  }
  if (e.key === 'Escape') {
    hover = null;
    select(getFrame(byId.get(selected)).id);
  }
  if (e.key === 'Backspace' && byId.get(selected).parentId) {
    e.preventDefault();
    select(byId.get(selected).parentId);
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'Alt') {
    altDownloadMode = false;
    clearNativeDownload();
  }
  if (e.code === 'Space') {
    space = false;
    $('viewport').classList.toggle('pan-mode', panMode);
  }
});
window.addEventListener('blur', () => {
  altDownloadMode = false;
  clearNativeDownload();
  space = false;
  drag = null;
  $('viewport').classList.remove('dragging');
  $('viewport').classList.toggle('pan-mode', panMode);
});
document.title = (D.title || 'Figma') + ' · 离线设计交付';
selected = regions[0].id;
setLibrary('pages');
renderScene();
overview();
renderInspector();
