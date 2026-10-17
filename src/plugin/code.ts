/// <reference types="@figma/plugin-typings" />

/* Read-only Figma collector. All archive generation happens in the local UI. */
// Authenticate bridge messages without assuming Figma's forwarded MessageEvent.source.
const bridgeChannel =
  Date.now().toString(36) +
  '-' +
  Math.random().toString(36).slice(2) +
  '-' +
  Math.random().toString(36).slice(2);
let busy = false,
  cancelled = false,
  runId = '',
  stopExport = null;
const containerTypes = new Set(['FRAME', 'SECTION', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET']);
const fields = [
  'locked',
  'layoutPositioning',
  'layoutAlign',
  'layoutGrow',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'absoluteBoundingBox',
  'absoluteTransform',
  'absoluteRenderBounds',
  'fills',
  'strokes',
  'strokeWeight',
  'strokeAlign',
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
  'dashPattern',
  'strokeCap',
  'strokeJoin',
  'strokesIncludedInLayout',
  'cornerRadius',
  'cornerSmoothing',
  'sectionContentsHidden',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
  'effects',
  'opacity',
  'blendMode',
  'clipsContent',
  'isMask',
  'maskType',
  'layoutMode',
  'layoutWrap',
  'gridRowGap',
  'gridColumnGap',
  'gridRowCount',
  'gridColumnCount',
  'itemSpacing',
  'counterAxisSpacing',
  'primaryAxisAlignItems',
  'counterAxisAlignItems',
  'layoutSizingHorizontal',
  'layoutSizingVertical',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fillStyleId',
  'strokeStyleId',
  'textStyleId',
  'boundVariables',
  'resolvedVariableModes',
  'exportSettings',
  'characters',
  'fontName',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlignHorizontal',
  'textAlignVertical',
  'textDecoration',
];
function clean(v) {
  if (typeof v === 'symbol') return 'MIXED';
  // JSON.stringify turns non-finite numbers into null and collapses -0. Objects still
  // go through JSON so host getters, functions and nested symbols stay plain data.
  if (typeof v === 'number') return Number.isFinite(v) ? (v === 0 ? 0 : v) : null;
  if (v === null || typeof v !== 'object') return v;
  return JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'symbol' ? 'MIXED' : x)));
}
const derivedGeometry = new Set([
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'absoluteBoundingBox',
  'absoluteTransform',
  'absoluteRenderBounds',
]);
function sameValue(a, b) {
  if (a === b || a === 'MIXED' || b === 'MIXED') return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-4;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameValue(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!sameValue(a[key], b[key])) return false;
    return true;
  }
  return false;
}
function designEdited(before, after) {
  if (before.length !== after.length) return true;
  for (let i = 0; i < before.length; i++) {
    const left = before[i],
      right = after[i];
    if (left.id !== right.id) return true;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (derivedGeometry.has(key)) continue;
      // Font loading during getCSSAsync drops the mixed-style segment list.
      if (key === 'textSegments' && (left[key] === undefined || right[key] === undefined)) continue;
      if (!sameValue(left[key], right[key])) return true;
    }
  }
  return false;
}
function post(type, data) {
  figma.ui.postMessage(Object.assign({ type, runId, channel: bridgeChannel }, data || {}));
}
function check() {
  if (cancelled) throw Error('已取消，原交付包没有变化。');
  if (stopExport) throw stopExport;
}
function haltExport(error) {
  if (!stopExport) stopExport = error instanceof Error ? error : Error(errorText(error));
}
// Figma renders exportAsync off the JS thread, but each large PNG stays resident until
// it returns. Four slots cover a normal 2× artboard; a near-8192px image takes all of them.
const exportSlots = 4;
function exportWeight(width, height, scale) {
  const pixels = Math.max(1, width) * Math.max(1, height) * scale * scale;
  if (pixels >= 16e6) return exportSlots;
  if (pixels >= 8e6) return 2;
  return 1;
}
function cutoutWeight(n, setting) {
  if (setting.format !== 'PNG') return 1;
  const c = setting.constraint;
  let scale = 1;
  if (c && c.type === 'SCALE') scale = c.value || 1;
  else if (c && c.type === 'WIDTH' && n.width) scale = c.value / n.width;
  else if (c && c.type === 'HEIGHT' && n.height) scale = c.value / n.height;
  return exportWeight(n.width || 1, n.height || 1, scale);
}
function createBudget(max) {
  let used = 0;
  const waiting = [];
  function pump() {
    while (waiting.length && used + waiting[0].cost <= max) {
      const job = waiting.shift();
      used += job.cost;
      job.start();
    }
  }
  return function occupy(cost, task) {
    const weight = Math.min(max, Math.max(1, cost | 0));
    return /** @type {Promise<any>} */ (new Promise((resolve, reject) => {
      waiting.push({
        cost: weight,
        start() {
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              used -= weight;
              pump();
            });
        },
      });
      pump();
    }));
  };
}
function settleAll(tasks) {
  return Promise.all(tasks).catch((error) =>
    Promise.allSettled(tasks).then(() => {
      throw error;
    }),
  );
}
let limitExport = createBudget(exportSlots);
let limitSection = createBudget(1);
function catalog(requestId = null) {
  post('catalog', {
    requestId,
    version: '1.6.0',
    title: figma.root.name,
    pages: figma.root.children.map((p) => ({ id: p.id, name: p.name })),
    currentPage: figma.currentPage.id,
    selection: figma.currentPage.selection.map((n) => ({ id: n.id, name: n.name, type: n.type })),
  });
}
figma.on('selectionchange', () => {
  if (!busy) catalog();
});
figma.on('currentpagechange', () => {
  if (!busy) catalog();
});
function pngSize(bytes) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (d.getUint32(0) !== 0x89504e47) throw Error('PNG 输出无效');
  return { pixelWidth: d.getUint32(16), pixelHeight: d.getUint32(20) };
}
function safeId(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '-');
}
function visible(n) {
  for (let p = n; p && p.type !== 'PAGE'; p = p.parent) if (p.visible === false) return false;
  return true;
}
function pageOf(n) {
  let p = n;
  while (p && p.type !== 'PAGE') p = p.parent;
  return p;
}
function topSelections(list) {
  const ids = new Set(list.map((n) => n.id));
  return list.filter((n) => {
    for (let p = n.parent; p && p.type !== 'PAGE'; p = p.parent) if (ids.has(p.id)) return false;
    return true;
  });
}
function rootsIn(page) {
  const result = [];
  function visit(n) {
    if (!visible(n)) return;
    if (containerTypes.has(n.type)) {
      result.push(n);
      return;
    }
    if (n.children) n.children.forEach(visit);
  }
  page.children.forEach(visit);
  return result;
}
function screenRoots(root) {
  if (root.type !== 'SECTION') return [root.id];
  const result = [];
  function visit(n) {
    if (!visible(n)) return;
    if (['FRAME', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET'].includes(n.type)) {
      result.push(n.id);
      return;
    }
    if (n.children) n.children.forEach(visit);
  }
  root.children.forEach(visit);
  return result.length ? result : [root.id];
}

/** Walk a root and copy the fields the handoff viewer needs. */
function serialize(root, pageId, nav, out, natives) {
  const screens = new Set(nav);
  function visit(n, parentId, depth, frameId, inheritedVisible) {
    const item: Record<string, any> = {
      id: n.id,
      name: n.name,
      type: n.type,
      parentId,
      depth,
      regionId: root.id,
      pageId,
      frameId: screens.has(n.id) ? n.id : frameId,
      visible: inheritedVisible && n.visible !== false,
    };
    for (const k of fields) {
      try {
        if (n[k] !== undefined) item[k] = clean(n[k]);
      } catch (e) {
        /* unsupported property on this node type */
      }
    }
    if (!item.absoluteBoundingBox) return;
    if (
      n.type === 'TEXT' &&
      [n.fontName, n.fontSize, n.fills, n.lineHeight, n.letterSpacing].some(
        (v) => typeof v === 'symbol',
      )
    ) {
      try {
        item.textSegments = clean(
          n.getStyledTextSegments([
            'fontName',
            'fontSize',
            'fontWeight',
            'fills',
            'fillStyleId',
            'lineHeight',
            'letterSpacing',
            'textDecoration',
          ]),
        );
      } catch (e) {
        throw Error('无法读取混合文本样式：' + n.name);
      }
    }
    out.push(item);
    natives.set(n.id, n);
    if (n.children)
      n.children.forEach((c) => visit(c, n.id, depth + 1, item.frameId, item.visible));
  }
  visit(root, null, 0, root.id, true);
}

/** First explicit SVG and PNG export on the layer. */
function candidateSettings(n) {
  // Keep the first configured export per supported format. Never override its
  // PNG scale or fixed WIDTH/HEIGHT constraint, and never mutate the source.
  const formats = new Set();
  return (n.exportSettings || [])
    .filter((s) => {
      if (!['SVG', 'PNG'].includes(s.format) || formats.has(s.format)) return false;
      formats.add(s.format);
      return true;
    })
    .map((s) => clean(s));
}
const iconShapes = new Set([
  'VECTOR',
  'STAR',
  'LINE',
  'ELLIPSE',
  'POLYGON',
  'BOOLEAN_OPERATION',
  'REGULAR_POLYGON',
]);
const iconContainers = new Set(['GROUP', 'FRAME', 'COMPONENT', 'INSTANCE', 'BOOLEAN_OPERATION']);
let iconMemo = new Map(),
  graphicMemo = new Map(),
  fragmentMemo = new Map();
function namedIcon(n) {
  return /图标|(^|[^a-z0-9])(icons?|ico?)([^a-z0-9]|$)|icons?$/i.test(String(n?.name || ''));
}
function paintList(n, key) {
  const list = n[key];
  return Array.isArray(list) ? list : [];
}
function hasImagePaint(n) {
  return ['fills', 'strokes'].some((key) =>
    paintList(n, key).some((p) => p && p.visible !== false && p.type === 'IMAGE'),
  );
}
function withinIconSize(n) {
  const w = n.width,
    h = n.height;
  if (!(typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0)) return false;
  const long = Math.max(w, h),
    short = Math.min(w, h);
  if (long / short > 3) return false;
  const cap = n.type === 'COMPONENT' || n.type === 'INSTANCE' || namedIcon(n) ? 96 : 64;
  return long <= cap + 0.5;
}
function graphicTree(n) {
  if (n?.id && graphicMemo.has(n.id)) return graphicMemo.get(n.id);
  let ok = false;
  if (n.visible === false) ok = true;
  else if (n.type === 'TEXT' || n.type === 'SLICE' || hasImagePaint(n)) ok = false;
  else {
    const kids = n.children || [];
    if (iconShapes.has(n.type) || n.type === 'RECTANGLE') ok = kids.every(graphicTree);
    else if (iconContainers.has(n.type))
      ok = kids.some((c) => c.visible !== false) && kids.every(graphicTree);
  }
  if (n?.id) graphicMemo.set(n.id, ok);
  return ok;
}
function hasDrawing(n) {
  if (n.visible === false) return false;
  if (iconShapes.has(n.type)) return true;
  return (n.children || []).some(hasDrawing);
}
function boxesOverlap(a, b) {
  const A = a.absoluteBoundingBox,
    B = b.absoluteBoundingBox;
  if (!validBox(A) || !validBox(B)) return false;
  return (
    A.x < B.x + B.width - 0.5 &&
    B.x < A.x + A.width - 0.5 &&
    A.y < B.y + B.height - 0.5 &&
    B.y < A.y + A.height - 0.5
  );
}
function fragmentSet(parent) {
  if (fragmentMemo.has(parent.id)) return fragmentMemo.get(parent.id);
  const ids = new Set();
  fragmentMemo.set(parent.id, ids);
  const leaves = (parent.children || []).filter(
    (c) =>
      c.visible !== false &&
      iconShapes.has(c.type) &&
      !(c.children || []).some((k) => k.visible !== false),
  );
  if (leaves.length < 4) return ids;
  for (const leaf of leaves) {
    if (namedIcon(leaf)) continue;
    let overlaps = 0;
    for (const other of leaves)
      if (other !== leaf && boxesOverlap(leaf, other) && ++overlaps >= 2) {
        ids.add(leaf.id);
        break;
      }
  }
  return ids;
}
function isIllustrationFragment(n) {
  // Overlapping paths inside a large graphic are illustration detail, not icons.
  if (!iconShapes.has(n.type) || (n.children || []).some((c) => c.visible !== false)) return false;
  const p = n.parent;
  if (!p || p.type === 'PAGE' || p.type === 'COMPONENT' || p.type === 'INSTANCE') return false;
  if (namedIcon(n) || namedIcon(p) || Math.max(p.width || 0, p.height || 0) <= 96) return false;
  return fragmentSet(p).has(n.id);
}
function isAutoIcon(n) {
  if (!n?.id) return false;
  if (iconMemo.has(n.id)) return iconMemo.get(n.id);
  iconMemo.set(n.id, false);
  const ok =
    n.visible !== false &&
    n.opacity !== 0 &&
    !n.isMask &&
    n.type !== 'COMPONENT_SET' &&
    n.type !== 'SECTION' &&
    withinIconSize(n) &&
    graphicTree(n) &&
    (hasDrawing(n) || namedIcon(n)) &&
    !isIllustrationFragment(n);
  iconMemo.set(n.id, ok);
  return ok;
}
function exportPlan(n) {
  const explicit = candidateSettings(n);
  if (explicit.length) return { settings: explicit, source: 'configured' };
  if (!isAutoIcon(n)) return null;
  for (let p = n.parent; p && p.type !== 'PAGE'; p = p.parent)
    if (candidateSettings(p).length || isAutoIcon(p)) return null;
  return { settings: [{ format: 'SVG' }], source: 'auto' };
}
// Section PNG exports can include Figma-specific margins and can downscale a whole
// canvas. Compose independent raster previews in a self-contained SVG instead.
// No clones, temporary pages or mutations of the source document are needed.
function errorText(e) {
  return e && e.message
    ? e.message
    : typeof e === 'string'
      ? e
      : String(e || 'Figma 未返回错误详情');
}
// Resolve only names used by the exported nodes. Keep metadata on each node so
// partial updates never rewrite tokens belonging to an unselected Frame.

/** Variables and styles referenced by one node. */
async function readColorBindings(item, cache) {
  const bindings = [];
  function lookup(kind, id, read) {
    const key = kind + ':' + id;
    if (!cache.has(key))
      cache.set(
        key,
        Promise.resolve()
          .then(read)
          .catch(() => null),
      );
    return cache.get(key);
  }
  async function variable(alias) {
    if (
      !alias ||
      alias.type !== 'VARIABLE_ALIAS' ||
      typeof alias.id !== 'string' ||
      !figma.variables?.getVariableByIdAsync
    )
      return null;
    const v = await lookup('variable', alias.id, () =>
      figma.variables.getVariableByIdAsync(alias.id),
    );
    if (!v) return null;
    const collection = figma.variables.getVariableCollectionByIdAsync
      ? await lookup('collection', v.variableCollectionId, () =>
          figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId),
        )
      : null;
    const modeId = item.resolvedVariableModes?.[v.variableCollectionId];
    return {
      id: v.id,
      name: v.name,
      collectionId: v.variableCollectionId,
      collectionName: collection?.name || null,
      modeId: modeId || null,
      modeName: collection?.modes?.find((m) => m.modeId === modeId)?.name || null,
      cssName: v.codeSyntax?.WEB || null,
    };
  }
  async function paints(list, path, styleId) {
    const style =
      typeof styleId === 'string' && styleId && figma.getStyleByIdAsync
        ? await lookup('style', styleId, () => figma.getStyleByIdAsync(styleId))
        : null;
    for (let i = 0; i < (Array.isArray(list) ? list.length : 0); i++) {
      const p = list[i];
      if (p.visible === false) continue;
      const v = await variable(p.boundVariables?.color);
      if (v || style)
        bindings.push({
          path: path + '.' + i,
          variable: v,
          style: style ? { id: style.id, name: style.name } : null,
        });
      for (let j = 0; j < (p.gradientStops || []).length; j++) {
        const stop = await variable(p.gradientStops[j].boundVariables?.color);
        if (stop) bindings.push({ path: path + '.' + i + '.gradientStops.' + j, variable: stop });
      }
    }
  }
  await paints(item.fills, 'fills', item.fillStyleId);
  await paints(item.strokes, 'strokes', item.strokeStyleId);
  for (let i = 0; i < (item.textSegments || []).length; i++)
    await paints(
      item.textSegments[i].fills,
      'textSegments.' + i + '.fills',
      item.textSegments[i].fillStyleId,
    );
  for (let i = 0; i < (item.effects || []).length; i++) {
    const e = item.effects[i];
    if (e.visible === false) continue;
    const v = await variable(e.boundVariables?.color);
    if (v) bindings.push({ path: 'effects.' + i, variable: v });
  }
  return bindings;
}
function validBox(b) {
  return b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width > 0 && b.height > 0;
}
function matchesRaster(size, b, scale) {
  return (
    Math.abs(size.pixelWidth - b.width * scale) <= 2 &&
    Math.abs(size.pixelHeight - b.height * scale) <= 2
  );
}

/** Export one PNG preview, retrying render bounds when needed. */
async function drawRaster(n, requestedScale) {
  const box = n.absoluteBoundingBox,
    render = n.absoluteRenderBounds;
  if (!validBox(box)) throw Error('画板尺寸无效：' + n.name + '（' + n.id + '）');
  const attempts = [{ bounds: box, absolute: true }];
  if (validBox(render)) attempts.push({ bounds: render, absolute: false });
  const errors = [];
  for (const attempt of attempts) {
    check();
    const b = attempt.bounds,
      scale = Math.min(requestedScale, 8192 / Math.max(b.width, b.height));
    try {
      const bytes = await n.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: scale },
        contentsOnly: true,
        useAbsoluteBounds: attempt.absolute,
      });
      check();
      const size = pngSize(bytes);
      if (!matchesRaster(size, b, scale)) {
        errors.push(
          `实际 ${size.pixelWidth}×${size.pixelHeight}px，预期 ${Math.round(b.width * scale)}×${Math.round(b.height * scale)}px`,
        );
        continue;
      }
      return { bytes, bounds: b, scale, ...size };
    } catch (e) {
      if (cancelled) throw e;
      errors.push(errorText(e));
    }
  }
  throw Error('预览导出失败：' + n.name + '（' + n.id + '）。' + errors.join('；'));
}
async function raster(n, requestedScale, onStart = null): Promise<any> {
  const box = n.absoluteBoundingBox || {};
  const long = Math.max(box.width || 1, box.height || 1, 1);
  const scale = Math.min(requestedScale, 8192 / long);
  return limitExport(exportWeight(box.width || 1, box.height || 1, scale), async () => {
    try {
      check();
      if (onStart) onStart();
      return await drawRaster(n, requestedScale);
    } catch (e) {
      if (!cancelled) haltExport(e);
      throw stopExport || e;
    }
  });
}
function sectionCanCompose(n) {
  if (n.type !== 'SECTION') return true;
  // Complex section decorations and cross-sibling masks must stay in Figma's
  // renderer. Never silently approximate them or export the mask as artwork.
  if (n.cornerSmoothing > 0) return false;
  for (const paints of [n.fills, n.strokes]) {
    if (paints !== undefined && !Array.isArray(paints)) return false;
    const active = (paints || []).filter((p) => p.visible !== false);
    if (
      active.length > 1 ||
      active.some((p) => p.type !== 'SOLID' || (p.blendMode && p.blendMode !== 'NORMAL'))
    )
      return false;
  }
  return (n.children || [])
    .filter(visible)
    .every(
      (c) =>
        !c.isMask &&
        (!c.blendMode || ['NORMAL', 'PASS_THROUGH'].includes(c.blendMode)) &&
        sectionCanCompose(c),
    );
}
function sectionShape(n, b, inset = 0) {
  const x = b.x + inset,
    y = b.y + inset,
    w = Math.max(0, b.width - 2 * inset),
    h = Math.max(0, b.height - 2 * inset);
  const radius = (k) =>
    typeof n[k] === 'number' ? n[k] : typeof n.cornerRadius === 'number' ? n.cornerRadius : 0;
  const radii = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'].map(
    (k) => Math.min(w / 2, h / 2, Math.max(0, radius(k) - inset)),
  );
  const [tl, tr, br, bl] = radii;
  return `M${x + tl} ${y}H${x + w - tr}A${tr} ${tr} 0 0 1 ${x + w} ${y + tr}V${y + h - br}A${br} ${br} 0 0 1 ${x + w - br} ${y + h}H${x + bl}A${bl} ${bl} 0 0 1 ${x} ${y + h - bl}V${y + tl}A${tl} ${tl} 0 0 1 ${x + tl} ${y}Z`;
}
function sectionPaint(n, b) {
  const rgb = (p) =>
    'rgb(' + ['r', 'g', 'b'].map((k) => Math.round(p.color[k] * 255)).join(',') + ')';
  const result = [];
  // Composition accepts one visible solid paint per fill/stroke; richer paints
  // are delegated to native rendering by sectionCanCompose.
  for (const p of [...(n.fills || [])].reverse())
    if (p.visible !== false)
      result.push(
        `<path d="${sectionShape(n, b)}" fill="${rgb(p)}" fill-opacity="${p.opacity === undefined ? 1 : p.opacity}"/>`,
      );
  const weight = typeof n.strokeWeight === 'number' ? n.strokeWeight : 0,
    inset = n.strokeAlign === 'INSIDE' ? weight / 2 : n.strokeAlign === 'OUTSIDE' ? -weight / 2 : 0;
  if (weight > 0)
    for (const p of [...(n.strokes || [])].reverse())
      if (p.visible !== false)
        result.push(
          `<path d="${sectionShape(n, b, inset)}" fill="none" stroke="${rgb(p)}" stroke-opacity="${p.opacity === undefined ? 1 : p.opacity}" stroke-width="${weight}"/>`,
        );
  return result.join('');
}

/** Frame PNG, or a self-contained SVG for a simple Section. */
async function exportPreview(n, requestedScale, prefix, warnings) {
  const b = n.absoluteBoundingBox;
  if (!validBox(b)) throw Error('画板尺寸无效：' + n.name + '（' + n.id + '）');
  if (n.type !== 'SECTION' || !sectionCanCompose(n)) {
    if (n.type === 'SECTION')
      warnings.push('区域 ' + n.name + ' 含复杂背景或跨图层合成，使用 Figma 整区渲染以保留效果。');
    const p = await raster(n, requestedScale),
      path = `previews/${prefix}-${safeId(n.id)}.png`;
    post('file', { path, bytes: p.bytes });
    if (p.scale < requestedScale)
      warnings.push(
        '预览 ' + n.name + ' 已按单张 8192px 上限降至 ' + Number(p.scale.toFixed(4)) + '×。',
      );
    return {
      id: n.id,
      path,
      scale: p.scale,
      inset: 0,
      offsetX: p.bounds.x - b.x,
      offsetY: p.bounds.y - b.y,
      displayWidth: p.bounds.width,
      displayHeight: p.bounds.height,
      pixelWidth: p.pixelWidth,
      pixelHeight: p.pixelHeight,
    };
  }
  // One composite at a time: its tiles already share the export slots.
  return limitSection(1, () => composeSection(n, b, requestedScale, prefix, warnings));
}
async function composeSection(n, b, requestedScale, prefix, warnings) {
  check();
  const parts = [];
  function plan(child) {
    check();
    if (!visible(child)) return;
    if (child.type === 'SECTION') {
      const cb = child.absoluteBoundingBox;
      if (!validBox(cb)) return;
      parts.push({ paint: sectionPaint(child, { ...cb, x: cb.x - b.x, y: cb.y - b.y }) });
      // Hidden Section contents are an editor presentation state, not deletion.
      for (const c of child.children || []) plan(c);
      return;
    }
    // Keep groups/frames atomic: their internal masks, clipping and effects are
    // rendered by Figma, rather than reconstructed from descendant PNGs.
    if (child.type === 'SLICE' || child.opacity === 0 || !validBox(child.absoluteBoundingBox))
      return;
    if ('absoluteRenderBounds' in child && child.absoluteRenderBounds === null) return;
    parts.push({ node: child });
  }
  plan(n);
  const rasters = parts.filter((part) => part.node);
  await settleAll(
    rasters.map((part, index) =>
      raster(part.node, requestedScale, () => {
        post('progress', {
          message: `区域 ${n.name}：预览 ${index + 1}/${rasters.length} · ${part.node.name}`,
        });
      }).then((preview) => {
        part.preview = preview;
      }),
    ),
  );
  const fragments = [],
    tiles = [];
  for (const part of parts) {
    if ('paint' in part) {
      if (part.paint) fragments.push(part.paint);
      continue;
    }
    const p = part.preview,
      x = p.bounds.x - b.x,
      y = p.bounds.y - b.y;
    fragments.push(
      `<image x="${x}" y="${y}" width="${p.bounds.width}" height="${p.bounds.height}" preserveAspectRatio="none" href="data:image/png;base64,${figma.base64Encode(p.bytes)}"/>`,
    );
    tiles.push({
      nodeId: part.node.id,
      x,
      y,
      width: p.bounds.width,
      height: p.bounds.height,
      scale: p.scale,
      pixelWidth: p.pixelWidth,
      pixelHeight: p.pixelHeight,
    });
    if (p.scale < requestedScale)
      warnings.push(
        '预览 ' + part.node.name + ' 已按单张 8192px 上限降至 ' + Number(p.scale.toFixed(4)) + '×。',
      );
  }
  check();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}">${fragments.join('')}</svg>`;
  // The generated XML contains numeric geometry and Base64 only (ASCII).
  const bytes = new Uint8Array(svg.length);
  for (let i = 0; i < svg.length; i++) bytes[i] = svg.charCodeAt(i);
  const path = `previews/${prefix}-${safeId(n.id)}.svg`;
  post('file', { path, bytes });
  return {
    id: n.id,
    path,
    format: 'section-composite',
    requestedScale,
    inset: 0,
    offsetX: 0,
    offsetY: 0,
    displayWidth: b.width,
    displayHeight: b.height,
    tiles,
  };
}

/** Read-only export. Archive bytes are assembled in the UI. */
async function collect(options) {
  stopExport = null;
  limitExport = createBudget(exportSlots);
  limitSection = createBudget(1);
  check();
  const roots = [],
    pages = [];
  if (options.mode === 'update' || options.scope === 'selection') {
    const selection = topSelections(figma.currentPage.selection);
    if (!selection.length) throw Error('请先在 Figma 中选中需要导出的 Frame 或 Section。');
    if (selection.some((n) => !containerTypes.has(n.type) || !visible(n)))
      throw Error('请选择可见的 Frame / Section / Component，而不是按钮或文字图层。');
    if (options.mode === 'update') {
      const allowed = new Set(options.allowedRootIds || []);
      if (selection.some((n) => !allowed.has(n.id)))
        throw Error('当前选中画板不在旧交付包中，请选择原 Frame / Section。');
    }
    roots.push(...selection);
    const p = figma.currentPage;
    pages.push({ id: p.id, name: p.name, regions: selection.map((n) => n.id) });
  } else {
    for (const pageId of options.pageIds || []) {
      check();
      const p = figma.root.children.find((p) => p.id === pageId);
      if (!p) throw Error('页面不存在：' + pageId);
      post('progress', { message: '加载页面：' + p.name });
      await p.loadAsync();
      const r = rootsIn(p);
      roots.push(...r);
      if (r.length) pages.push({ id: p.id, name: p.name, regions: r.map((n) => n.id) });
    }
  }
  if (!roots.length) throw Error('所选范围没有可见的 Frame 或 Section。');
  const nodes = [],
    natives = new Map(),
    navigation = [],
    previews = [],
    assets = [],
    warnings = [],
    assetFailures = [];
  post('progress', { message: `读取图层：${roots.length} 个区域` });
  for (const root of roots) {
    const nav = screenRoots(root);
    navigation.push(...nav);
    serialize(root, pageOf(root).id, nav, nodes, natives);
  }
  const prefix = 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const previewScale = Number(options.previewScale) || 2;
  previews.push(
    ...(await settleAll(
      roots.map((n, i) => {
        post('progress', { message: `设计稿 ${i + 1}/${roots.length}：${n.name}` });
        return exportPreview(n, previewScale, prefix, warnings);
      }),
    )),
  );
  // Explicit SVG/PNG exports, plus icon-sized graphics that were never marked.
  // Plan every cutout before the first exportAsync so icon identity stays single-threaded.
  iconMemo = new Map();
  graphicMemo = new Map();
  fragmentMemo = new Map();
  const groups = [];
  let cutoutCount = 0;
  post('progress', { message: `整理切图：${nodes.length} 个图层` });
  for (const data of nodes) {
    check();
    const n = natives.get(data.id);
    if (!data.visible || data.opacity === 0 || data.width <= 0 || data.height <= 0) continue;
    const plan = exportPlan(n);
    if (!plan) continue;
    const jobs = [];
    for (let j = 0; j < plan.settings.length; j++) {
      const setting = Object.assign({}, plan.settings[j]);
      setting.contentsOnly = true;
      if (setting.format === 'SVG') setting.svgOutlineText = true;
      jobs.push({ setting, j, index: cutoutCount++ });
    }
    // One node keeps its formats in order. Different nodes share the export slots.
    groups.push({
      data,
      n,
      plan,
      jobs,
      weight: Math.max(...jobs.map((job) => cutoutWeight(n, job.setting))),
    });
  }
  const outcomes = new Array(cutoutCount);
  await settleAll(
    groups.map((group) =>
      limitExport(group.weight, async () => {
        check();
        const { data, n, plan } = group;
        for (const job of group.jobs) {
          check();
          const { setting, j, index } = job;
          post('progress', { message: `切图 ${index + 1}/${cutoutCount}：${n.name}` });
          try {
            const bytes = await n.exportAsync(setting);
            check();
            const format = setting.format.toLowerCase(),
              path = `assets/${prefix}-${safeId(n.id)}-${j}.${format}`;
            const rb = n.absoluteRenderBounds || n.absoluteBoundingBox;
            let scale = 1;
            if (setting.constraint) {
              const c = setting.constraint;
              const area = setting.useAbsoluteBounds ? n.absoluteBoundingBox : rb;
              scale =
                c.type === 'SCALE'
                  ? c.value
                  : c.value / (c.type === 'WIDTH' ? area.width : area.height);
            }
            const asset = {
              id: n.id + '-' + j,
              name: n.name,
              width: n.width,
              height: n.height,
              format,
              frameId: data.frameId,
              regionId: data.regionId,
              path,
              bytes: bytes.length,
              nodeIds: [n.id],
              uses: [
                {
                  nodeId: n.id,
                  name: n.name,
                  frameId: data.frameId,
                  regionId: data.regionId,
                  width: n.width,
                  height: n.height,
                },
              ],
              scale,
              scaleLabel: format === 'svg' ? '矢量' : Math.round(scale * 100) / 100 + '×',
              exportSettings: clean(setting),
            };
            if (format === 'png') Object.assign(asset, pngSize(bytes));
            post('file', { path, bytes });
            outcomes[index] = asset;
          } catch (e) {
            if (cancelled) throw e;
            const frame = natives.get(data.frameId),
              region = natives.get(data.regionId),
              page = pageOf(n),
              nodePath = [];
            for (let parent = n; parent && parent.type !== 'PAGE'; parent = parent.parent)
              nodePath.unshift({ id: parent.id, name: parent.name });
            const failure = {
              nodeId: n.id,
              nodeName: n.name,
              pageId: page.id,
              pageName: page.name,
              regionId: data.regionId,
              regionName: region?.name || data.regionId,
              frameId: data.frameId,
              frameName: frame?.name || data.frameId,
              nodePath,
              format: setting.format,
              exportSettings: clean(setting),
              source: plan.source,
              message: errorText(e),
            };
            const message =
              '切图导出失败：' +
              page.name +
              ' / ' +
              failure.frameName +
              '（' +
              data.frameId +
              '） / ' +
              n.name +
              '（' +
              n.id +
              '） [' +
              setting.format +
              '] ' +
              failure.message;
            outcomes[index] = { failure, message };
          }
        }
      }),
    ),
  );
  for (const outcome of outcomes) {
    if (!outcome) continue;
    if (outcome.failure) {
      assetFailures.push(outcome.failure);
      post('asset-warning', { message: outcome.message, failure: outcome.failure });
    } else assets.push(outcome);
  }
  check();
  // Keep asynchronous CSS separate from the geometry snapshot until validation.
  const cssRecords = new Map(),
    cssFailures = [],
    colorRecords = new Map(),
    colorCache = new Map();
  for (let start = 0; start < nodes.length; start += 16) {
    check();
    post('progress', {
      message: `读取 CSS 与颜色变量：${Math.min(start + 16, nodes.length)}/${nodes.length}`,
    });
    await Promise.all(
      nodes.slice(start, start + 16).map(async (item) => {
        check();
        const native = natives.get(item.id);
        if (typeof native.getCSSAsync === 'function')
          try {
            const raw = await native.getCSSAsync();
            if (!raw || typeof raw !== 'object' || Array.isArray(raw))
              throw Error('Figma CSS 返回格式无效');
            const entries = Object.entries(raw).filter(
              ([key, value]) => typeof value === 'string' && key.length > 0,
            );
            cssRecords.set(item.id, Object.fromEntries(entries));
          } catch (e) {
            cssFailures.push({ id: item.id, name: item.name, message: errorText(e) });
          }
        check();
        const bindings = await readColorBindings(item, colorCache);
        if (bindings.length) colorRecords.set(item.id, bindings);
        check();
      }),
    );
  }
  check();
  // Re-read only the collected roots. Editing while exporting must not produce a mixed snapshot.
  // exportAsync and getCSSAsync refresh render bounds, sub-pixel geometry and unloaded
  // fonts without any user edit; those derived fields are not design changes.
  const endNodes = [],
    endNative = new Map();
  for (const root of roots)
    serialize(root, pageOf(root).id, screenRoots(root), endNodes, endNative);
  if (designEdited(nodes, endNodes))
    throw Error('导出过程中设计稿发生变化，请停止编辑后重新导出。');
  for (const item of nodes) if (cssRecords.has(item.id)) item.figmaCSS = cssRecords.get(item.id);
  for (const item of nodes)
    if (colorRecords.has(item.id)) item.colorBindings = colorRecords.get(item.id);
  if (cssFailures.length)
    warnings.push(
      `Figma CSS 读取失败 ${cssFailures.length} 个图层，已保留本地推导参考：` +
        cssFailures
          .slice(0, 10)
          .map((f) => f.name + '（' + f.id + '）：' + f.message)
          .join('；'),
    );
  const design = {
    schemaVersion: 1,
    fileKey: figma.fileKey || null,
    title: figma.root.name,
    pages,
    nodes,
    navigation,
    exportedAt: new Date().toISOString(),
    generator: 'figma-offline-handoff/1.6.0',
  };
  post('complete', {
    design,
    previews,
    assets,
    warnings,
    assetFailures,
    selectedRootIds: roots.map((n) => n.id),
  });
}
figma.ui.onmessage = async (message) => {
  if (!message || message.channel !== bridgeChannel) return;
  if (message.type === 'ready' || message.type === 'get-state') {
    catalog(message.requestId);
    return;
  }
  if (message.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (message.type !== 'export' || busy) return;
  busy = true;
  cancelled = false;
  runId = message.runId;
  try {
    await collect(message.options);
  } catch (e) {
    post('error', { message: e.message || String(e) });
  } finally {
    busy = false;
    catalog();
  }
};

// Register handlers before loading the iframe so the initial ready message cannot race startup.
figma.showUI(__html__.split('__HANDOFF_CHANNEL__').join(bridgeChannel), {
  width: 480,
  height: 700,
  themeColors: true,
});
