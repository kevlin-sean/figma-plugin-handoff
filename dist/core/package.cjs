var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/core/package.ts
var package_exports = {};
__export(package_exports, {
  clone: () => clone,
  merge: () => merge,
  opaqueRect: () => opaqueRect,
  safePath: () => safePath,
  subtree: () => subtree,
  validate: () => validate
});
module.exports = __toCommonJS(package_exports);
var clone = (x) => JSON.parse(JSON.stringify(x));
function fail(message) {
  throw Error(message);
}
function safePath(path) {
  if (typeof path !== "string" || !path || path.includes("\\") || path.startsWith("/") || path.split("/").some((p) => p === ".." || p === ".") || /^[a-z]+:/i.test(path))
    fail("\u5305\u5185\u8DEF\u5F84\u65E0\u6548\uFF1A" + path);
  return path;
}
function subtree(nodes, id) {
  const result = /* @__PURE__ */ new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes)
      if (result.has(n.parentId) && !result.has(n.id)) {
        result.add(n.id);
        changed = true;
      }
  }
  return result;
}
function validate(design, assets, previews) {
  if (!design || !Array.isArray(design.nodes) || !design.nodes.length || !Array.isArray(design.pages) || !design.pages.length)
    fail("\u4EA4\u4ED8\u5305\u7F3A\u5C11\u9875\u9762\u6216\u56FE\u5C42\u6570\u636E");
  if (!Array.isArray(assets) || !Array.isArray(previews)) fail("\u4EA4\u4ED8\u5305\u7F3A\u5C11\u5207\u56FE\u6216\u9884\u89C8\u7D22\u5F15");
  const ids = /* @__PURE__ */ new Set();
  for (const n of design.nodes) {
    if (!n.id || ids.has(n.id)) fail("\u91CD\u590D\u6216\u65E0\u6548\u7684\u56FE\u5C42 ID");
    ids.add(n.id);
    const b = n.absoluteBoundingBox;
    if (!b || ![b.x, b.y, b.width, b.height, n.width, n.height].every(Number.isFinite))
      fail("\u56FE\u5C42\u5750\u6807\u65E0\u6548\uFF1A" + n.id);
  }
  for (const n of design.nodes)
    for (const k of ["parentId", "regionId", "frameId"])
      if (n[k] && !ids.has(n[k])) fail("\u56FE\u5C42\u5F15\u7528\u7F3A\u5931\uFF1A" + n.id + " / " + k);
  const nodeMap = new Map(design.nodes.map((n) => [n.id, n]));
  for (const n of design.nodes) {
    if (n.parentId && !(nodeMap.get(n.parentId).depth < n.depth)) fail("\u56FE\u5C42\u5C42\u7EA7\u65E0\u6548\uFF1A" + n.id);
    if (n.depth === 0 && n.parentId) fail("\u6839\u56FE\u5C42\u4E0D\u80FD\u6709\u7236\u7EA7");
  }
  for (const p of design.pages) {
    if (!Array.isArray(p.regions) || !p.regions.length) fail("\u9875\u9762\u6CA1\u6709\u5BFC\u51FA\u533A\u57DF");
    for (const id of p.regions)
      if (!ids.has(id) || !previews.some((v) => v.id === id)) fail("\u9875\u9762\u9884\u89C8\u7F3A\u5931\uFF1A" + id);
  }
  for (const p of previews) {
    safePath(p.path);
    if (!ids.has(p.id)) fail("\u9884\u89C8\u56FE\u5C42\u4E0D\u5B58\u5728");
    for (const q of p.patches || []) safePath(q.path);
  }
  for (const a of assets) {
    safePath(a.path);
    if (!Array.isArray(a.nodeIds) || !a.nodeIds.length || a.nodeIds.some((id) => !ids.has(id)))
      fail("\u5207\u56FE\u56FE\u5C42\u5F15\u7528\u7F3A\u5931\uFF1A" + a.path);
  }
  return {
    pages: design.pages.length,
    regions: previews.length,
    nodes: design.nodes.length,
    assets: assets.length
  };
}
function almost(a, b) {
  return Math.abs(a - b) < 0.01;
}
function opaqueRect(n) {
  const fills = Array.isArray(n.fills) ? n.fills.filter((p) => p.visible !== false) : [];
  return n.type === "FRAME" && n.clipsContent === true && (n.opacity ?? 1) === 1 && (!n.blendMode || ["NORMAL", "PASS_THROUGH"].includes(n.blendMode)) && !n.rotation && [
    "cornerRadius",
    "topLeftRadius",
    "topRightRadius",
    "bottomLeftRadius",
    "bottomRightRadius"
  ].every((k) => !n[k]) && !(n.effects || []).some((e) => e.visible !== false) && fills.some((p) => p.type === "SOLID" && (p.opacity ?? 1) === 1) && (n.absoluteTransform ? almost(n.absoluteTransform[0][0], 1) && almost(n.absoluteTransform[0][1], 0) && almost(n.absoluteTransform[1][0], 0) && almost(n.absoluteTransform[1][1], 1) : true);
}
function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
function contains(a, b) {
  return b.x >= a.x - 0.01 && b.y >= a.y - 0.01 && b.x + b.width <= a.x + a.width + 0.01 && b.y + b.height <= a.y + a.height + 0.01;
}
function translate(n, dx, dy) {
  for (const key of ["absoluteBoundingBox", "absoluteRenderBounds"])
    if (n[key]) {
      n[key].x += dx;
      n[key].y += dy;
    }
  if (n.absoluteTransform) {
    n.absoluteTransform[0][2] += dx;
    n.absoluteTransform[1][2] += dy;
  }
}
function merge(baseline, incoming, selectedIds) {
  validate(baseline.design, baseline.assets, baseline.previews);
  validate(incoming.design, incoming.assets, incoming.previews);
  if (baseline.design.fileKey && incoming.design.fileKey && baseline.design.fileKey !== incoming.design.fileKey)
    fail("\u65E7\u4EA4\u4ED8\u5305\u4E0D\u5C5E\u4E8E\u5F53\u524D Figma \u6587\u4EF6");
  const result = clone({
    design: baseline.design,
    assets: baseline.assets,
    previews: baseline.previews
  }), oldMap = new Map(baseline.design.nodes.map((n) => [n.id, n])), newMap = new Map(incoming.design.nodes.map((n) => [n.id, n]));
  if (!selectedIds.length || new Set(selectedIds).size !== selectedIds.length)
    fail("\u6CA1\u6709\u6709\u6548\u66F4\u65B0\u76EE\u6807");
  const removed = /* @__PURE__ */ new Set(), changes = [];
  const maps = [];
  for (const id of selectedIds) {
    const old = oldMap.get(id), fresh = newMap.get(id);
    if (!old || !fresh)
      fail("\u65E7\u5305\u4E2D\u627E\u4E0D\u5230\u540C ID \u753B\u677F\uFF1A" + id + "\u3002\u8BF7\u9009\u4E2D\u539F\u753B\u677F\uFF1B\u91CD\u5EFA\u540E\u7684\u65B0 ID \u9700\u8981\u91CD\u65B0\u5BFC\u51FA\u3002");
    if (!["FRAME", "SECTION", "COMPONENT", "INSTANCE", "COMPONENT_SET"].includes(old.type) || old.type !== fresh.type)
      fail("\u753B\u677F\u7C7B\u578B\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u5BFC\u51FA\u8BE5\u533A\u57DF");
    const ids = subtree(baseline.design.nodes, id);
    if ([...ids].some((x) => removed.has(x))) fail("\u66F4\u65B0\u76EE\u6807\u4E0D\u80FD\u4E92\u76F8\u5305\u542B");
    for (const x of ids) removed.add(x);
    const newIds = subtree(incoming.design.nodes, id), dx = old.absoluteBoundingBox.x - fresh.absoluteBoundingBox.x, dy = old.absoluteBoundingBox.y - fresh.absoluteBoundingBox.y;
    maps.push({ id, old, fresh, ids, newIds, dx, dy });
    changes.push({
      id,
      name: old.name,
      oldNodes: ids.size,
      newNodes: newIds.size,
      preservePosition: true
    });
  }
  for (const m of maps) {
    for (const id of m.newIds)
      if (oldMap.has(id) && !removed.has(id)) fail("\u65B0\u5B50\u56FE\u5C42 ID \u4E0E\u672A\u66F4\u65B0\u533A\u57DF\u51B2\u7A81\uFF1A" + id);
    const image = clone(incoming.previews.find((p) => p.id === m.id));
    if (!image) fail("\u66F4\u65B0\u753B\u677F\u7F3A\u5C11\u9884\u89C8");
    if (m.old.depth === 0) {
      const at = result.previews.findIndex((p) => p.id === m.id);
      if (at < 0) fail("\u65E7\u9884\u89C8\u7F3A\u5931");
      result.previews[at] = image;
    } else {
      if (!opaqueRect(m.old) || !opaqueRect(m.fresh) || !almost(m.old.width, m.fresh.width) || !almost(m.old.height, m.fresh.height))
        fail(
          "\u5D4C\u5957\u753B\u677F\u66F4\u65B0\u9700\u8981\u540C\u5C3A\u5BF8\u3001\u4E0D\u900F\u660E\u3001\u65E0\u5706\u89D2/\u9634\u5F71\u4E14\u5F00\u542F\u88C1\u526A\u7684 Frame\u3002\u8BF7\u9009\u62E9\u6700\u5916\u5C42\u4EA4\u4ED8\u533A\u57DF\u540E\u66F4\u65B0\u3002"
        );
      const region = oldMap.get(m.old.regionId), rb = region.absoluteBoundingBox, b = m.old.absoluteBoundingBox;
      const patch = {
        nodeId: m.id,
        frameId: m.id,
        path: image.path,
        x: b.x - rb.x,
        y: b.y - rb.y,
        width: b.width,
        height: b.height,
        background: "transparent"
      };
      if (!contains({ x: 0, y: 0, width: rb.width, height: rb.height }, patch))
        fail("\u753B\u677F\u8D85\u51FA\u65E7\u533A\u57DF\u8303\u56F4\uFF0C\u8BF7\u66F4\u65B0\u6700\u5916\u5C42\u533A\u57DF");
      let branch = m.old;
      while (branch && branch.id !== region.id) {
        const index = baseline.design.nodes.findIndex((n) => n.id === branch.id);
        const later = baseline.design.nodes.filter(
          (n, i) => i > index && n.parentId === branch.parentId && n.visible !== false && !removed.has(n.id)
        );
        if (later.some((n) => intersects(n.absoluteRenderBounds || n.absoluteBoundingBox, b)))
          fail("\u753B\u677F\u4E0E\u4E0A\u5C42\u5144\u5F1F\u56FE\u5C42\u91CD\u53E0\uFF0C\u8BF7\u66F4\u65B0\u6700\u5916\u5C42\u533A\u57DF");
        const parent = oldMap.get(branch.parentId);
        if (parent && (parent.isMask || (parent.opacity ?? 1) !== 1 || (parent.effects || []).some((e) => e.visible !== false) || parent.blendMode && !["NORMAL", "PASS_THROUGH"].includes(parent.blendMode)))
          fail("\u7236\u7EA7\u5408\u6210\u6548\u679C\u4E0D\u9002\u5408\u5C40\u90E8\u8986\u76D6\uFF0C\u8BF7\u66F4\u65B0\u6700\u5916\u5C42\u533A\u57DF");
        if (parent?.clipsContent && !contains(parent.absoluteBoundingBox, b))
          fail("\u753B\u677F\u88AB\u7236\u7EA7\u88C1\u526A\uFF0C\u8BF7\u66F4\u65B0\u6700\u5916\u5C42\u533A\u57DF");
        branch = parent;
      }
      const p = result.previews.find((p2) => p2.id === region.id);
      if (!p) fail("\u65E7\u533A\u57DF\u9884\u89C8\u7F3A\u5931");
      p.patches = (p.patches || []).filter((q) => {
        if (!intersects(patch, q)) return true;
        if (contains(patch, q)) return false;
        fail("\u4E0E\u5DF2\u6709\u5C40\u90E8\u8865\u4E01\u4EA4\u53C9\uFF0C\u8BF7\u66F4\u65B0\u6700\u5916\u5C42\u533A\u57DF");
      });
      p.patches.push(patch);
    }
  }
  const replacements = /* @__PURE__ */ new Map();
  for (const m of maps) {
    const block = incoming.design.nodes.filter((n) => m.newIds.has(n.id)).map((n) => {
      const x = clone(n);
      translate(x, m.dx, m.dy);
      x.depth = m.old.depth + n.depth;
      x.regionId = m.old.regionId;
      if (m.old.pageId) x.pageId = m.old.pageId;
      else delete x.pageId;
      if (m.old.depth > 0) x.frameId = m.old.frameId;
      if (x.id === m.id) {
        x.parentId = m.old.parentId;
        x.x = m.old.x;
        x.y = m.old.y;
      }
      return x;
    });
    replacements.set(m.id, block);
  }
  result.design.nodes = baseline.design.nodes.flatMap(
    (n) => replacements.get(n.id) || (removed.has(n.id) ? [] : [clone(n)])
  );
  result.assets = baseline.assets.flatMap((a) => {
    const kept = a.nodeIds.filter((id) => !removed.has(id));
    if (!kept.length) return [];
    if (kept.length === a.nodeIds.length) return [clone(a)];
    const x = clone(a);
    x.nodeIds = kept;
    x.uses = (x.uses || []).filter((u) => !removed.has(u.nodeId));
    const owner = oldMap.get(kept[0]);
    x.frameId = owner.frameId;
    x.regionId = owner.regionId;
    return [x];
  });
  for (const a of incoming.assets) {
    const owner = maps.find((m) => a.nodeIds.some((id) => m.newIds.has(id)));
    if (!owner) continue;
    const x = clone(a);
    x.regionId = owner.old.regionId;
    if (owner.old.depth > 0) x.frameId = owner.old.frameId;
    for (const u of x.uses || []) {
      u.regionId = owner.old.regionId;
      if (owner.old.depth > 0) u.frameId = owner.old.frameId;
    }
    result.assets.push(x);
  }
  if (result.design.navigation) {
    const nav = incoming.design.navigation || selectedIds;
    result.design.navigation = result.design.navigation.flatMap((id) => {
      const m = maps.find((m2) => m2.ids.has(id));
      if (!m) return [id];
      if (m.id !== id && result.design.navigation.includes(m.id)) return [];
      return nav.filter((n) => m.newIds.has(n));
    });
    result.design.navigation = [...new Set(result.design.navigation)];
  }
  result.design.exportedAt = incoming.design.exportedAt;
  result.changes = changes;
  validate(result.design, result.assets, result.previews);
  const finalMap = new Map(result.design.nodes.map((n) => [n.id, n]));
  for (const n of baseline.design.nodes)
    if (!removed.has(n.id) && JSON.stringify(n) !== JSON.stringify(finalMap.get(n.id)))
      fail("\u672A\u9009\u4E2D\u56FE\u5C42\u53D1\u751F\u610F\u5916\u53D8\u5316\uFF1A" + n.id);
  return result;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  clone,
  merge,
  opaqueRect,
  safePath,
  subtree,
  validate
});
