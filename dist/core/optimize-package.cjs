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

// src/core/optimize-package.ts
var optimize_package_exports = {};
__export(optimize_package_exports, {
  managed: () => managed,
  optimize: () => optimize,
  references: () => references
});
module.exports = __toCommonJS(optimize_package_exports);

// src/core/resource-identity.ts
var tags = new Set(
  "svg g defs symbol pattern marker use path rect circle ellipse line polyline polygon linearGradient radialGradient stop clipPath mask filter image title desc text tspan textPath feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence".split(
    " "
  )
);
var validId = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
function canonicalSvg(text) {
  if (typeof text !== "string" || /<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(text)) return null;
  const tokens = [], ids = /* @__PURE__ */ new Map(), stack = [];
  let cursor = 0, roots = 0;
  const markup = /<\?xml\s[\s\S]*?\?>|<!--[\s\S]*?-->|<\/?[A-Za-z][^<>]*>/g;
  function literal(value) {
    if (value.includes("<") || /&(?!amp;|lt;|gt;|quot;|apos;|#[0-9]+;|#x[0-9a-fA-F]+;)/.test(value))
      throw Error();
    if (!stack.length && value.trim()) throw Error();
    tokens.push(["text", value]);
  }
  try {
    let ref = function(id) {
      if (!ids.has(id)) throw Error();
      return ["ref", ids.get(id)];
    };
    let m;
    while (m = markup.exec(text)) {
      literal(text.slice(cursor, m.index));
      cursor = markup.lastIndex;
      const raw = m[0];
      if (raw.startsWith("<?")) {
        if (roots || stack.length) throw Error();
        tokens.push(["xml", raw]);
        continue;
      }
      if (raw.startsWith("<!--")) {
        if (raw.slice(4, -3).includes("--")) throw Error();
        tokens.push(["comment", raw]);
        continue;
      }
      const close = /^<\/([A-Za-z][\w.-]*)\s*>$/.exec(raw);
      if (close) {
        if (stack.pop() !== close[1]) throw Error();
        tokens.push(["close", close[1]]);
        continue;
      }
      const open = /^<([A-Za-z][\w.-]*)([\s\S]*?)(\/?)>$/.exec(raw);
      if (!open || !tags.has(open[1])) throw Error();
      if (!stack.length && (open[1] !== "svg" || ++roots !== 1)) throw Error();
      const attrs = [], names = /* @__PURE__ */ new Set(), body = open[2], pattern = /\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/gy;
      let at = 0, a;
      while (a = pattern.exec(body)) {
        at = pattern.lastIndex;
        const name = a[1], value = a[2] === void 0 ? a[3] : a[2];
        if (names.has(name) || /^on/i.test(name) || /^(begin|end|aria-)/.test(name) || value.includes("\\") || /&(?!amp;|lt;|gt;|quot;|apos;|#[0-9]+;|#x[0-9a-fA-F]+;)/.test(value))
          throw Error();
        if (name === "xmlns" && value !== "http://www.w3.org/2000/svg") throw Error();
        if (name.includes(":") && !(name === "xmlns:xlink" && value === "http://www.w3.org/1999/xlink") && !["xlink:href", "xml:space"].includes(name))
          throw Error();
        names.add(name);
        attrs.push([name, value]);
        if (name === "id") {
          if (!validId.test(value) || ids.has(value)) throw Error();
          ids.set(value, ids.size);
        }
      }
      if (body.slice(at).trim()) throw Error();
      tokens.push(["open", open[1], attrs, Boolean(open[3])]);
      if (!open[3]) stack.push(open[1]);
    }
    literal(text.slice(cursor));
    if (stack.length || roots !== 1) throw Error();
    for (const token of tokens)
      if (token[0] === "open")
        for (const attr of token[2]) {
          const [name, value] = attr;
          if (name === "id") {
            attr[1] = ["id", ids.get(value)];
            continue;
          }
          if (name === "href" || name === "xlink:href") {
            if (value.startsWith("#")) attr[1] = ref(value.slice(1));
            else if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(value))
              throw Error();
            continue;
          }
          const pattern = /url\(\s*(['"]?)#([A-Za-z_][A-Za-z0-9_.:-]*)\1\s*\)/g, parts = [];
          let at = 0, p;
          while (p = pattern.exec(value)) {
            parts.push(value.slice(at, p.index), ref(p[2]));
            at = pattern.lastIndex;
          }
          if (parts.length) {
            parts.push(value.slice(at));
            if (parts.some((v) => typeof v === "string" && /url\s*\(/i.test(v))) throw Error();
            attr[1] = parts;
          } else if (/url\s*\(/i.test(value)) throw Error();
        }
    const builtin = /* @__PURE__ */ new Set([
      "SourceGraphic",
      "SourceAlpha",
      "BackgroundImage",
      "BackgroundAlpha",
      "FillPaint",
      "StrokePaint"
    ]);
    let filter = null;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token[0] === "open" && token[1] === "filter") {
        if (filter) throw Error();
        filter = { results: /* @__PURE__ */ new Map(), end: i };
        if (!token[3]) {
          let j = i + 1;
          for (; j < tokens.length; j++) {
            if (tokens[j][0] === "open" && tokens[j][1] === "filter") throw Error();
            if (tokens[j][0] === "close" && tokens[j][1] === "filter") break;
          }
          if (j === tokens.length) throw Error();
          filter.end = j;
        }
        for (let j = i + 1; j < filter.end; j++)
          if (tokens[j][0] === "open") {
            for (const [name, value] of tokens[j][2])
              if (name === "result") {
                if (!tokens[j][1].startsWith("fe") || typeof value !== "string" || !validId.test(value) || builtin.has(value) || filter.results.has(value))
                  throw Error();
                filter.results.set(value, filter.results.size);
              }
          }
      }
      if (token[0] === "open") {
        for (const attr of token[2])
          if (["result", "in", "in2"].includes(attr[0])) {
            if (!filter || !token[1].startsWith("fe") || typeof attr[1] !== "string")
              throw Error();
            if (attr[0] !== "result" && builtin.has(attr[1])) continue;
            if (!filter.results.has(attr[1])) throw Error();
            attr[1] = ["filter-ref", filter.results.get(attr[1])];
          }
      }
      if (filter && i === filter.end) filter = null;
    }
    return JSON.stringify(tokens);
  } catch {
    return null;
  }
}

// src/core/optimize-package.ts
function identity(path, bytes) {
  if (!path.toLowerCase().endsWith(".svg") || bytes.length > 8 * 1024 * 1024) return bytes;
  try {
    return canonicalSvg(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) || bytes;
  } catch {
    return bytes;
  }
}
function signature(bytes) {
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++)
    h = Math.imul(h ^ (typeof bytes === "string" ? bytes.charCodeAt(i) : bytes[i]), 16777619);
  return bytes.length + ":" + (h >>> 0);
}
function same(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function stable(x) {
  if (Array.isArray(x)) return x.map(stable);
  if (x && typeof x === "object")
    return Object.fromEntries(
      Object.keys(x).sort().map((k) => [k, stable(x[k])])
    );
  return x;
}
function assetKey(a) {
  const x = { ...a };
  for (const k of ["id", "path", "nodeIds", "uses", "frameId", "regionId"]) delete x[k];
  return JSON.stringify(stable(x));
}
function references(data) {
  return /* @__PURE__ */ new Set([
    ...data.assets.map((a) => a.path),
    ...data.previews.flatMap((p) => [p.path, ...(p.patches || []).map((q) => q.path)])
  ]);
}
function managed(path) {
  return /^(assets|previews)\/r-[a-z0-9]+-[a-z0-9]+-[a-zA-Z0-9_-]+\.(png|svg|webp)$/.test(path);
}
async function optimize(data, zip, prefix, { baseline = null, check = () => {
}, progress = () => {
} } = {}) {
  const report = {
    assetEntriesBefore: data.assets.length,
    assetEntriesAfter: 0,
    resourceFilesBefore: 0,
    resourceFilesAfter: 0,
    reusedFiles: [],
    removedFiles: [],
    removedBytes: 0,
    nameConflicts: []
  };
  const prior = baseline ? references(baseline) : /* @__PURE__ */ new Set();
  const paths = [...references(data)].sort(
    (a, b) => Number(!prior.has(a)) - Number(!prior.has(b))
  ), buckets = /* @__PURE__ */ new Map(), aliases = /* @__PURE__ */ new Map(), sizes = /* @__PURE__ */ new Map();
  report.resourceFilesBefore = paths.length;
  for (let i = 0; i < paths.length; i++) {
    check();
    const path = paths[i], file = zip.file(prefix + path);
    if (!file) throw Error("\u6253\u5305\u7F3A\u5C11\u8D44\u6E90\uFF1A" + path);
    progress(`\u53BB\u91CD\u8D44\u6E90 ${i + 1}/${paths.length}`);
    const bytes = await file.async("uint8array"), content = identity(path, bytes), kind = typeof content === "string" ? "svg-local-ids" : "bytes", key = path.split(".").pop().toLowerCase() + ":" + kind + ":" + signature(content), bucket = buckets.get(key) || [];
    let canonical = null;
    sizes.set(path, bytes.length);
    for (const candidate of bucket) {
      check();
      const other = identity(candidate, await zip.file(prefix + candidate).async("uint8array"));
      if (kind === "svg-local-ids" ? content === other : same(bytes, other)) {
        canonical = candidate;
        break;
      }
    }
    if (canonical) {
      aliases.set(path, canonical);
      report.reusedFiles.push({
        from: path,
        to: canonical,
        bytes: bytes.length,
        comparison: kind
      });
    } else {
      bucket.push(path);
      buckets.set(key, bucket);
    }
  }
  for (const a of data.assets) {
    a.path = aliases.get(a.path) || a.path;
    if (a.bytes !== void 0) a.bytes = sizes.get(a.path);
  }
  for (const p of data.previews) {
    p.path = aliases.get(p.path) || p.path;
    for (const q of p.patches || []) q.path = aliases.get(q.path) || q.path;
  }
  function bindings(assets2) {
    const result = /* @__PURE__ */ new Set();
    for (const a of assets2) {
      for (const id of a.nodeIds) result.add(JSON.stringify([a.path, assetKey(a), "node", id]));
      for (const u of a.uses || [])
        result.add(JSON.stringify([a.path, assetKey(a), "use", stable(u)]));
    }
    return result;
  }
  const expectedBindings = bindings(data.assets);
  const records = /* @__PURE__ */ new Map(), assets = [];
  for (const a of data.assets) {
    const key = a.path + "\n" + assetKey(a), existing = records.get(key);
    if (!existing) {
      records.set(key, a);
      assets.push(a);
      continue;
    }
    existing.nodeIds = [.../* @__PURE__ */ new Set([...existing.nodeIds, ...a.nodeIds])];
    const uses = [...existing.uses || [], ...a.uses || []], seen = /* @__PURE__ */ new Set();
    existing.uses = uses.filter((u) => {
      const k = JSON.stringify(stable(u));
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  const actualBindings = bindings(assets);
  if (expectedBindings.size !== actualBindings.size || [...expectedBindings].some((k) => !actualBindings.has(k)))
    throw Error("\u53BB\u91CD\u6821\u9A8C\u5931\u8D25\uFF1A\u56FE\u5C42\u6216\u753B\u677F\u5173\u8054\u4E22\u5931\u3002");
  data.assets = assets;
  report.assetEntriesAfter = assets.length;
  const names = /* @__PURE__ */ new Map();
  for (const a of assets) {
    const key = JSON.stringify([a.name, a.format]), group = names.get(key) || [];
    group.push(a);
    names.set(key, group);
  }
  for (const group of names.values())
    if (new Set(group.map((a) => a.path)).size > 1)
      report.nameConflicts.push({
        name: group[0].name,
        format: group[0].format,
        variants: group.map((a) => ({
          path: a.path,
          width: a.width,
          height: a.height,
          scale: a.scale,
          nodeIds: a.nodeIds
        }))
      });
  const used = references(data), known = /* @__PURE__ */ new Set([...paths, ...baseline ? references(baseline) : []]);
  for (const fullPath of Object.keys(zip.files)) {
    check();
    if (!fullPath.startsWith(prefix) || zip.files[fullPath].dir) continue;
    const path = fullPath.slice(prefix.length);
    if (!/^(assets|previews)\//.test(path) || used.has(path) || !known.has(path) && !managed(path))
      continue;
    const bytes = (await zip.file(fullPath).async("uint8array")).length;
    zip.remove(fullPath);
    report.removedFiles.push({ path, bytes });
    report.removedBytes += bytes;
  }
  const shared = /* @__PURE__ */ new Map();
  for (const a of assets) {
    const g = shared.get(a.path) || { nodes: /* @__PURE__ */ new Set(), frames: /* @__PURE__ */ new Set() };
    for (const id of a.nodeIds) g.nodes.add(id);
    for (const u of a.uses || []) if (u.frameId) g.frames.add(u.frameId);
    if (a.frameId) g.frames.add(a.frameId);
    shared.set(a.path, g);
  }
  report.sharedAssets = [...shared].filter(([, g]) => g.nodes.size > 1).map(([path, g]) => ({ path, nodeIds: [...g.nodes], frameIds: [...g.frames] }));
  for (const path of used)
    if (!zip.file(prefix + path)) throw Error("\u53BB\u91CD\u6821\u9A8C\u5931\u8D25\uFF0C\u7F3A\u5C11\u8D44\u6E90\uFF1A" + path);
  for (const [key, paths2] of buckets)
    if (paths2.length > 1) {
      for (let i = 0; i < paths2.length; i++)
        for (let j = 0; j < i; j++) {
          check();
          const a = identity(paths2[i], await zip.file(prefix + paths2[i]).async("uint8array")), b = identity(paths2[j], await zip.file(prefix + paths2[j]).async("uint8array"));
          if (typeof a === "string" ? a === b : same(a, b))
            throw Error("\u53BB\u91CD\u6821\u9A8C\u5931\u8D25\uFF0C\u5B58\u5728\u91CD\u590D\u8D44\u6E90\uFF1A" + key);
        }
    }
  report.resourceFilesAfter = used.size;
  report.validated = true;
  check();
  return report;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  managed,
  optimize,
  references
});
