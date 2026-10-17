(() => {
  // src/plugin/code.ts
  var bridgeChannel = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + "-" + Math.random().toString(36).slice(2);
  var busy = false;
  var cancelled = false;
  var runId = "";
  var containerTypes = /* @__PURE__ */ new Set(["FRAME", "SECTION", "COMPONENT", "INSTANCE", "COMPONENT_SET"]);
  var fields = [
    "locked",
    "layoutPositioning",
    "layoutAlign",
    "layoutGrow",
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "absoluteBoundingBox",
    "absoluteTransform",
    "absoluteRenderBounds",
    "fills",
    "strokes",
    "strokeWeight",
    "strokeAlign",
    "strokeTopWeight",
    "strokeRightWeight",
    "strokeBottomWeight",
    "strokeLeftWeight",
    "dashPattern",
    "strokeCap",
    "strokeJoin",
    "strokesIncludedInLayout",
    "cornerRadius",
    "cornerSmoothing",
    "sectionContentsHidden",
    "topLeftRadius",
    "topRightRadius",
    "bottomLeftRadius",
    "bottomRightRadius",
    "effects",
    "opacity",
    "blendMode",
    "clipsContent",
    "isMask",
    "maskType",
    "layoutMode",
    "layoutWrap",
    "gridRowGap",
    "gridColumnGap",
    "gridRowCount",
    "gridColumnCount",
    "itemSpacing",
    "counterAxisSpacing",
    "primaryAxisAlignItems",
    "counterAxisAlignItems",
    "layoutSizingHorizontal",
    "layoutSizingVertical",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fillStyleId",
    "strokeStyleId",
    "textStyleId",
    "boundVariables",
    "resolvedVariableModes",
    "exportSettings",
    "characters",
    "fontName",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "textAlignHorizontal",
    "textAlignVertical",
    "textDecoration"
  ];
  function clean(v) {
    return JSON.parse(JSON.stringify(v, (k, x) => typeof x === "symbol" ? "MIXED" : x));
  }
  function post(type, data) {
    figma.ui.postMessage(Object.assign({ type, runId, channel: bridgeChannel }, data || {}));
  }
  function check() {
    if (cancelled) throw Error("\u5DF2\u53D6\u6D88\uFF0C\u539F\u4EA4\u4ED8\u5305\u6CA1\u6709\u53D8\u5316\u3002");
  }
  function catalog(requestId = null) {
    post("catalog", {
      requestId,
      version: "1.6.0",
      title: figma.root.name,
      pages: figma.root.children.map((p) => ({ id: p.id, name: p.name })),
      currentPage: figma.currentPage.id,
      selection: figma.currentPage.selection.map((n) => ({ id: n.id, name: n.name, type: n.type }))
    });
  }
  figma.on("selectionchange", () => {
    if (!busy) catalog();
  });
  figma.on("currentpagechange", () => {
    if (!busy) catalog();
  });
  function pngSize(bytes) {
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (d.getUint32(0) !== 2303741511) throw Error("PNG \u8F93\u51FA\u65E0\u6548");
    return { pixelWidth: d.getUint32(16), pixelHeight: d.getUint32(20) };
  }
  function safeId(id) {
    return id.replace(/[^a-zA-Z0-9_-]/g, "-");
  }
  function visible(n) {
    for (let p = n; p && p.type !== "PAGE"; p = p.parent) if (p.visible === false) return false;
    return true;
  }
  function pageOf(n) {
    let p = n;
    while (p && p.type !== "PAGE") p = p.parent;
    return p;
  }
  function topSelections(list) {
    const ids = new Set(list.map((n) => n.id));
    return list.filter((n) => {
      for (let p = n.parent; p && p.type !== "PAGE"; p = p.parent) if (ids.has(p.id)) return false;
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
    if (root.type !== "SECTION") return [root.id];
    const result = [];
    function visit(n) {
      if (!visible(n)) return;
      if (["FRAME", "COMPONENT", "INSTANCE", "COMPONENT_SET"].includes(n.type)) {
        result.push(n.id);
        return;
      }
      if (n.children) n.children.forEach(visit);
    }
    root.children.forEach(visit);
    return result.length ? result : [root.id];
  }
  function serialize(root, pageId, nav, out, natives) {
    const screens = new Set(nav);
    function visit(n, parentId, depth, frameId, inheritedVisible) {
      const item = {
        id: n.id,
        name: n.name,
        type: n.type,
        parentId,
        depth,
        regionId: root.id,
        pageId,
        frameId: screens.has(n.id) ? n.id : frameId,
        visible: inheritedVisible && n.visible !== false
      };
      for (const k of fields) {
        try {
          if (n[k] !== void 0) item[k] = clean(n[k]);
        } catch (e) {
        }
      }
      if (!item.absoluteBoundingBox) return;
      if (n.type === "TEXT" && [n.fontName, n.fontSize, n.fills, n.lineHeight, n.letterSpacing].some(
        (v) => typeof v === "symbol"
      )) {
        try {
          item.textSegments = clean(
            n.getStyledTextSegments([
              "fontName",
              "fontSize",
              "fontWeight",
              "fills",
              "fillStyleId",
              "lineHeight",
              "letterSpacing",
              "textDecoration"
            ])
          );
        } catch (e) {
          throw Error("\u65E0\u6CD5\u8BFB\u53D6\u6DF7\u5408\u6587\u672C\u6837\u5F0F\uFF1A" + n.name);
        }
      }
      out.push(item);
      natives.set(n.id, n);
      if (n.children)
        n.children.forEach((c) => visit(c, n.id, depth + 1, item.frameId, item.visible));
    }
    visit(root, null, 0, root.id, true);
  }
  function candidateSettings(n) {
    const formats = /* @__PURE__ */ new Set();
    return (n.exportSettings || []).filter((s) => {
      if (!["SVG", "PNG"].includes(s.format) || formats.has(s.format)) return false;
      formats.add(s.format);
      return true;
    }).map((s) => clean(s));
  }
  var iconShapes = /* @__PURE__ */ new Set([
    "VECTOR",
    "STAR",
    "LINE",
    "ELLIPSE",
    "POLYGON",
    "BOOLEAN_OPERATION",
    "REGULAR_POLYGON"
  ]);
  var iconContainers = /* @__PURE__ */ new Set(["GROUP", "FRAME", "COMPONENT", "INSTANCE", "BOOLEAN_OPERATION"]);
  var iconMemo = /* @__PURE__ */ new Map();
  function namedIcon(n) {
    return /图标|(^|[^a-z0-9])(icons?|ico?)([^a-z0-9]|$)|icons?$/i.test(String(n?.name || ""));
  }
  function paintList(n, key) {
    const list = n[key];
    return Array.isArray(list) ? list : [];
  }
  function hasImagePaint(n) {
    return ["fills", "strokes"].some(
      (key) => paintList(n, key).some((p) => p && p.visible !== false && p.type === "IMAGE")
    );
  }
  function withinIconSize(n) {
    const w = n.width, h = n.height;
    if (!(typeof w === "number" && typeof h === "number" && w > 0 && h > 0)) return false;
    const long = Math.max(w, h), short = Math.min(w, h);
    if (long / short > 3) return false;
    const cap = n.type === "COMPONENT" || n.type === "INSTANCE" || namedIcon(n) ? 96 : 64;
    return long <= cap + 0.5;
  }
  function graphicTree(n) {
    if (n.visible === false) return true;
    if (n.type === "TEXT" || n.type === "SLICE" || hasImagePaint(n)) return false;
    const kids = n.children || [];
    if (iconShapes.has(n.type) || n.type === "RECTANGLE") return kids.every(graphicTree);
    if (iconContainers.has(n.type))
      return kids.some((c) => c.visible !== false) && kids.every(graphicTree);
    return false;
  }
  function hasDrawing(n) {
    if (n.visible === false) return false;
    if (iconShapes.has(n.type)) return true;
    return (n.children || []).some(hasDrawing);
  }
  function boxesOverlap(a, b) {
    const A = a.absoluteBoundingBox, B = b.absoluteBoundingBox;
    if (!validBox(A) || !validBox(B)) return false;
    return A.x < B.x + B.width - 0.5 && B.x < A.x + A.width - 0.5 && A.y < B.y + B.height - 0.5 && B.y < A.y + A.height - 0.5;
  }
  function isIllustrationFragment(n) {
    if (!iconShapes.has(n.type) || (n.children || []).some((c) => c.visible !== false)) return false;
    const p = n.parent;
    if (!p || p.type === "PAGE" || p.type === "COMPONENT" || p.type === "INSTANCE") return false;
    if (namedIcon(n) || namedIcon(p) || Math.max(p.width || 0, p.height || 0) <= 96) return false;
    const leaves = (p.children || []).filter(
      (c) => c.visible !== false && iconShapes.has(c.type) && !(c.children || []).some((k) => k.visible !== false)
    );
    if (leaves.length < 4) return false;
    let overlaps = 0;
    for (const other of leaves) if (other !== n && boxesOverlap(n, other) && ++overlaps >= 2) return true;
    return false;
  }
  function isAutoIcon(n) {
    if (!n?.id) return false;
    if (iconMemo.has(n.id)) return iconMemo.get(n.id);
    iconMemo.set(n.id, false);
    const ok = n.visible !== false && n.opacity !== 0 && !n.isMask && n.type !== "COMPONENT_SET" && n.type !== "SECTION" && withinIconSize(n) && graphicTree(n) && (hasDrawing(n) || namedIcon(n)) && !isIllustrationFragment(n);
    iconMemo.set(n.id, ok);
    return ok;
  }
  function exportPlan(n) {
    const explicit = candidateSettings(n);
    if (explicit.length) return { settings: explicit, source: "configured" };
    if (!isAutoIcon(n)) return null;
    for (let p = n.parent; p && p.type !== "PAGE"; p = p.parent)
      if (candidateSettings(p).length || isAutoIcon(p)) return null;
    return { settings: [{ format: "SVG" }], source: "auto" };
  }
  function errorText(e) {
    return e && e.message ? e.message : typeof e === "string" ? e : String(e || "Figma \u672A\u8FD4\u56DE\u9519\u8BEF\u8BE6\u60C5");
  }
  async function readColorBindings(item, cache) {
    const bindings = [];
    function lookup(kind, id, read) {
      const key = kind + ":" + id;
      if (!cache.has(key))
        cache.set(
          key,
          Promise.resolve().then(read).catch(() => null)
        );
      return cache.get(key);
    }
    async function variable(alias) {
      if (!alias || alias.type !== "VARIABLE_ALIAS" || typeof alias.id !== "string" || !figma.variables?.getVariableByIdAsync)
        return null;
      const v = await lookup(
        "variable",
        alias.id,
        () => figma.variables.getVariableByIdAsync(alias.id)
      );
      if (!v) return null;
      const collection = figma.variables.getVariableCollectionByIdAsync ? await lookup(
        "collection",
        v.variableCollectionId,
        () => figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId)
      ) : null;
      const modeId = item.resolvedVariableModes?.[v.variableCollectionId];
      return {
        id: v.id,
        name: v.name,
        collectionId: v.variableCollectionId,
        collectionName: collection?.name || null,
        modeId: modeId || null,
        modeName: collection?.modes?.find((m) => m.modeId === modeId)?.name || null,
        cssName: v.codeSyntax?.WEB || null
      };
    }
    async function paints(list, path, styleId) {
      const style = typeof styleId === "string" && styleId && figma.getStyleByIdAsync ? await lookup("style", styleId, () => figma.getStyleByIdAsync(styleId)) : null;
      for (let i = 0; i < (Array.isArray(list) ? list.length : 0); i++) {
        const p = list[i];
        if (p.visible === false) continue;
        const v = await variable(p.boundVariables?.color);
        if (v || style)
          bindings.push({
            path: path + "." + i,
            variable: v,
            style: style ? { id: style.id, name: style.name } : null
          });
        for (let j = 0; j < (p.gradientStops || []).length; j++) {
          const stop = await variable(p.gradientStops[j].boundVariables?.color);
          if (stop) bindings.push({ path: path + "." + i + ".gradientStops." + j, variable: stop });
        }
      }
    }
    await paints(item.fills, "fills", item.fillStyleId);
    await paints(item.strokes, "strokes", item.strokeStyleId);
    for (let i = 0; i < (item.textSegments || []).length; i++)
      await paints(
        item.textSegments[i].fills,
        "textSegments." + i + ".fills",
        item.textSegments[i].fillStyleId
      );
    for (let i = 0; i < (item.effects || []).length; i++) {
      const e = item.effects[i];
      if (e.visible === false) continue;
      const v = await variable(e.boundVariables?.color);
      if (v) bindings.push({ path: "effects." + i, variable: v });
    }
    return bindings;
  }
  function validBox(b) {
    return b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width > 0 && b.height > 0;
  }
  function matchesRaster(size, b, scale) {
    return Math.abs(size.pixelWidth - b.width * scale) <= 2 && Math.abs(size.pixelHeight - b.height * scale) <= 2;
  }
  async function raster(n, requestedScale) {
    const box = n.absoluteBoundingBox, render = n.absoluteRenderBounds;
    if (!validBox(box)) throw Error("\u753B\u677F\u5C3A\u5BF8\u65E0\u6548\uFF1A" + n.name + "\uFF08" + n.id + "\uFF09");
    const attempts = [{ bounds: box, absolute: true }];
    if (validBox(render)) attempts.push({ bounds: render, absolute: false });
    const errors = [];
    for (const attempt of attempts) {
      check();
      const b = attempt.bounds, scale = Math.min(requestedScale, 8192 / Math.max(b.width, b.height));
      try {
        const bytes = await n.exportAsync({
          format: "PNG",
          constraint: { type: "SCALE", value: scale },
          contentsOnly: true,
          useAbsoluteBounds: attempt.absolute
        });
        check();
        const size = pngSize(bytes);
        if (!matchesRaster(size, b, scale)) {
          errors.push(
            `\u5B9E\u9645 ${size.pixelWidth}\xD7${size.pixelHeight}px\uFF0C\u9884\u671F ${Math.round(b.width * scale)}\xD7${Math.round(b.height * scale)}px`
          );
          continue;
        }
        return { bytes, bounds: b, scale, ...size };
      } catch (e) {
        if (cancelled) throw e;
        errors.push(errorText(e));
      }
    }
    throw Error("\u9884\u89C8\u5BFC\u51FA\u5931\u8D25\uFF1A" + n.name + "\uFF08" + n.id + "\uFF09\u3002" + errors.join("\uFF1B"));
  }
  function sectionCanCompose(n) {
    if (n.type !== "SECTION") return true;
    if (n.cornerSmoothing > 0) return false;
    for (const paints of [n.fills, n.strokes]) {
      if (paints !== void 0 && !Array.isArray(paints)) return false;
      const active = (paints || []).filter((p) => p.visible !== false);
      if (active.length > 1 || active.some((p) => p.type !== "SOLID" || p.blendMode && p.blendMode !== "NORMAL"))
        return false;
    }
    return (n.children || []).filter(visible).every(
      (c) => !c.isMask && (!c.blendMode || ["NORMAL", "PASS_THROUGH"].includes(c.blendMode)) && sectionCanCompose(c)
    );
  }
  function sectionShape(n, b, inset = 0) {
    const x = b.x + inset, y = b.y + inset, w = Math.max(0, b.width - 2 * inset), h = Math.max(0, b.height - 2 * inset);
    const radius = (k) => typeof n[k] === "number" ? n[k] : typeof n.cornerRadius === "number" ? n.cornerRadius : 0;
    const radii = ["topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius"].map(
      (k) => Math.min(w / 2, h / 2, Math.max(0, radius(k) - inset))
    );
    const [tl, tr, br, bl] = radii;
    return `M${x + tl} ${y}H${x + w - tr}A${tr} ${tr} 0 0 1 ${x + w} ${y + tr}V${y + h - br}A${br} ${br} 0 0 1 ${x + w - br} ${y + h}H${x + bl}A${bl} ${bl} 0 0 1 ${x} ${y + h - bl}V${y + tl}A${tl} ${tl} 0 0 1 ${x + tl} ${y}Z`;
  }
  function sectionPaint(n, b) {
    const rgb = (p) => "rgb(" + ["r", "g", "b"].map((k) => Math.round(p.color[k] * 255)).join(",") + ")";
    const result = [];
    for (const p of [...n.fills || []].reverse())
      if (p.visible !== false)
        result.push(
          `<path d="${sectionShape(n, b)}" fill="${rgb(p)}" fill-opacity="${p.opacity === void 0 ? 1 : p.opacity}"/>`
        );
    const weight = typeof n.strokeWeight === "number" ? n.strokeWeight : 0, inset = n.strokeAlign === "INSIDE" ? weight / 2 : n.strokeAlign === "OUTSIDE" ? -weight / 2 : 0;
    if (weight > 0) {
      for (const p of [...n.strokes || []].reverse())
        if (p.visible !== false)
          result.push(
            `<path d="${sectionShape(n, b, inset)}" fill="none" stroke="${rgb(p)}" stroke-opacity="${p.opacity === void 0 ? 1 : p.opacity}" stroke-width="${weight}"/>`
          );
    }
    return result.join("");
  }
  async function exportPreview(n, requestedScale, prefix, warnings) {
    const b = n.absoluteBoundingBox;
    if (!validBox(b)) throw Error("\u753B\u677F\u5C3A\u5BF8\u65E0\u6548\uFF1A" + n.name + "\uFF08" + n.id + "\uFF09");
    if (n.type !== "SECTION" || !sectionCanCompose(n)) {
      if (n.type === "SECTION")
        warnings.push("\u533A\u57DF " + n.name + " \u542B\u590D\u6742\u80CC\u666F\u6216\u8DE8\u56FE\u5C42\u5408\u6210\uFF0C\u4F7F\u7528 Figma \u6574\u533A\u6E32\u67D3\u4EE5\u4FDD\u7559\u6548\u679C\u3002");
      const p = await raster(n, requestedScale), path2 = `previews/${prefix}-${safeId(n.id)}.png`;
      post("file", { path: path2, bytes: p.bytes });
      if (p.scale < requestedScale)
        warnings.push(
          "\u9884\u89C8 " + n.name + " \u5DF2\u6309\u5355\u5F20 8192px \u4E0A\u9650\u964D\u81F3 " + Number(p.scale.toFixed(4)) + "\xD7\u3002"
        );
      return {
        id: n.id,
        path: path2,
        scale: p.scale,
        inset: 0,
        offsetX: p.bounds.x - b.x,
        offsetY: p.bounds.y - b.y,
        displayWidth: p.bounds.width,
        displayHeight: p.bounds.height,
        pixelWidth: p.pixelWidth,
        pixelHeight: p.pixelHeight
      };
    }
    const fragments = [], tiles = [];
    async function visit(child) {
      check();
      if (!visible(child)) return;
      if (child.type === "SECTION") {
        const cb = child.absoluteBoundingBox;
        if (!validBox(cb)) return;
        fragments.push(sectionPaint(child, { ...cb, x: cb.x - b.x, y: cb.y - b.y }));
        for (const c of child.children || []) await visit(c);
        return;
      }
      if (child.type === "SLICE" || child.opacity === 0 || !validBox(child.absoluteBoundingBox))
        return;
      if ("absoluteRenderBounds" in child && child.absoluteRenderBounds === null) return;
      post("progress", { message: `\u533A\u57DF ${n.name}\uFF1A\u9884\u89C8 ${tiles.length + 1} \xB7 ${child.name}` });
      const p = await raster(child, requestedScale), x = p.bounds.x - b.x, y = p.bounds.y - b.y;
      fragments.push(
        `<image x="${x}" y="${y}" width="${p.bounds.width}" height="${p.bounds.height}" preserveAspectRatio="none" href="data:image/png;base64,${figma.base64Encode(p.bytes)}"/>`
      );
      tiles.push({
        nodeId: child.id,
        x,
        y,
        width: p.bounds.width,
        height: p.bounds.height,
        scale: p.scale,
        pixelWidth: p.pixelWidth,
        pixelHeight: p.pixelHeight
      });
      if (p.scale < requestedScale)
        warnings.push(
          "\u9884\u89C8 " + child.name + " \u5DF2\u6309\u5355\u5F20 8192px \u4E0A\u9650\u964D\u81F3 " + Number(p.scale.toFixed(4)) + "\xD7\u3002"
        );
    }
    await visit(n);
    check();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}">${fragments.join("")}</svg>`;
    const bytes = new Uint8Array(svg.length);
    for (let i = 0; i < svg.length; i++) bytes[i] = svg.charCodeAt(i);
    const path = `previews/${prefix}-${safeId(n.id)}.svg`;
    post("file", { path, bytes });
    return {
      id: n.id,
      path,
      format: "section-composite",
      requestedScale,
      inset: 0,
      offsetX: 0,
      offsetY: 0,
      displayWidth: b.width,
      displayHeight: b.height,
      tiles
    };
  }
  async function collect(options) {
    check();
    const roots = [], pages = [];
    if (options.mode === "update" || options.scope === "selection") {
      const selection = topSelections(figma.currentPage.selection);
      if (!selection.length) throw Error("\u8BF7\u5148\u5728 Figma \u4E2D\u9009\u4E2D\u9700\u8981\u5BFC\u51FA\u7684 Frame \u6216 Section\u3002");
      if (selection.some((n) => !containerTypes.has(n.type) || !visible(n)))
        throw Error("\u8BF7\u9009\u62E9\u53EF\u89C1\u7684 Frame / Section / Component\uFF0C\u800C\u4E0D\u662F\u6309\u94AE\u6216\u6587\u5B57\u56FE\u5C42\u3002");
      if (options.mode === "update") {
        const allowed = new Set(options.allowedRootIds || []);
        if (selection.some((n) => !allowed.has(n.id)))
          throw Error("\u5F53\u524D\u9009\u4E2D\u753B\u677F\u4E0D\u5728\u65E7\u4EA4\u4ED8\u5305\u4E2D\uFF0C\u8BF7\u9009\u62E9\u539F Frame / Section\u3002");
      }
      roots.push(...selection);
      const p = figma.currentPage;
      pages.push({ id: p.id, name: p.name, regions: selection.map((n) => n.id) });
    } else {
      for (const pageId of options.pageIds || []) {
        check();
        const p = figma.root.children.find((p2) => p2.id === pageId);
        if (!p) throw Error("\u9875\u9762\u4E0D\u5B58\u5728\uFF1A" + pageId);
        post("progress", { message: "\u52A0\u8F7D\u9875\u9762\uFF1A" + p.name });
        await p.loadAsync();
        const r = rootsIn(p);
        roots.push(...r);
        if (r.length) pages.push({ id: p.id, name: p.name, regions: r.map((n) => n.id) });
      }
    }
    if (!roots.length) throw Error("\u6240\u9009\u8303\u56F4\u6CA1\u6709\u53EF\u89C1\u7684 Frame \u6216 Section\u3002");
    const nodes = [], natives = /* @__PURE__ */ new Map(), navigation = [], previews = [], assets = [], warnings = [], assetFailures = [];
    for (const root of roots) {
      const nav = screenRoots(root);
      navigation.push(...nav);
      serialize(root, pageOf(root).id, nav, nodes, natives);
    }
    const initialNodes = JSON.stringify(nodes);
    const prefix = "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    for (let i = 0; i < roots.length; i++) {
      check();
      const n = roots[i];
      post("progress", { message: `\u8BBE\u8BA1\u7A3F ${i + 1}/${roots.length}\uFF1A${n.name}` });
      previews.push(await exportPreview(n, Number(options.previewScale) || 2, prefix, warnings));
    }
    let count = 0;
    iconMemo = /* @__PURE__ */ new Map();
    for (const data of nodes) {
      check();
      const n = natives.get(data.id);
      if (!data.visible || data.opacity === 0 || data.width <= 0 || data.height <= 0) continue;
      const plan = exportPlan(n);
      if (!plan) continue;
      const settings = plan.settings;
      for (let j = 0; j < settings.length; j++) {
        check();
        const setting = Object.assign({}, settings[j]);
        setting.contentsOnly = true;
        if (setting.format === "SVG") setting.svgOutlineText = true;
        post("progress", { message: `\u5207\u56FE ${++count}\uFF1A${n.name}` });
        try {
          const bytes = await n.exportAsync(setting);
          check();
          const format = setting.format.toLowerCase(), path = `assets/${prefix}-${safeId(n.id)}-${j}.${format}`;
          const rb = n.absoluteRenderBounds || n.absoluteBoundingBox;
          let scale = 1;
          if (setting.constraint) {
            const c = setting.constraint;
            const area = setting.useAbsoluteBounds ? n.absoluteBoundingBox : rb;
            scale = c.type === "SCALE" ? c.value : c.value / (c.type === "WIDTH" ? area.width : area.height);
          }
          const a = {
            id: n.id + "-" + j,
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
                height: n.height
              }
            ],
            scale,
            scaleLabel: format === "svg" ? "\u77E2\u91CF" : Math.round(scale * 100) / 100 + "\xD7",
            exportSettings: clean(setting)
          };
          if (format === "png") Object.assign(a, pngSize(bytes));
          post("file", { path, bytes });
          assets.push(a);
        } catch (e) {
          if (cancelled) throw e;
          const frame = natives.get(data.frameId), region = natives.get(data.regionId), page = pageOf(n), nodePath = [];
          for (let parent = n; parent && parent.type !== "PAGE"; parent = parent.parent)
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
            message: errorText(e)
          };
          assetFailures.push(failure);
          const message = "\u5207\u56FE\u5BFC\u51FA\u5931\u8D25\uFF1A" + page.name + " / " + failure.frameName + "\uFF08" + data.frameId + "\uFF09 / " + n.name + "\uFF08" + n.id + "\uFF09 [" + setting.format + "] " + failure.message;
          post("asset-warning", { message, failure });
        }
      }
    }
    check();
    const cssRecords = /* @__PURE__ */ new Map(), cssFailures = [], colorRecords = /* @__PURE__ */ new Map(), colorCache = /* @__PURE__ */ new Map();
    for (let start = 0; start < nodes.length; start += 16) {
      check();
      post("progress", {
        message: `\u8BFB\u53D6 CSS \u4E0E\u989C\u8272\u53D8\u91CF\uFF1A${Math.min(start + 16, nodes.length)}/${nodes.length}`
      });
      await Promise.all(
        nodes.slice(start, start + 16).map(async (item) => {
          check();
          const native = natives.get(item.id);
          if (typeof native.getCSSAsync === "function")
            try {
              const raw = await native.getCSSAsync();
              if (!raw || typeof raw !== "object" || Array.isArray(raw))
                throw Error("Figma CSS \u8FD4\u56DE\u683C\u5F0F\u65E0\u6548");
              const entries = Object.entries(raw).filter(
                ([key, value]) => typeof value === "string" && key.length > 0
              );
              cssRecords.set(item.id, Object.fromEntries(entries));
            } catch (e) {
              cssFailures.push({ id: item.id, name: item.name, message: errorText(e) });
            }
          check();
          const bindings = await readColorBindings(item, colorCache);
          if (bindings.length) colorRecords.set(item.id, bindings);
          check();
        })
      );
    }
    check();
    const endNodes = [], endNative = /* @__PURE__ */ new Map();
    for (const root of roots)
      serialize(root, pageOf(root).id, screenRoots(root), endNodes, endNative);
    if (initialNodes !== JSON.stringify(endNodes))
      throw Error("\u5BFC\u51FA\u8FC7\u7A0B\u4E2D\u8BBE\u8BA1\u7A3F\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u505C\u6B62\u7F16\u8F91\u540E\u91CD\u65B0\u5BFC\u51FA\u3002");
    for (const item of nodes) if (cssRecords.has(item.id)) item.figmaCSS = cssRecords.get(item.id);
    for (const item of nodes)
      if (colorRecords.has(item.id)) item.colorBindings = colorRecords.get(item.id);
    if (cssFailures.length)
      warnings.push(
        `Figma CSS \u8BFB\u53D6\u5931\u8D25 ${cssFailures.length} \u4E2A\u56FE\u5C42\uFF0C\u5DF2\u4FDD\u7559\u672C\u5730\u63A8\u5BFC\u53C2\u8003\uFF1A` + cssFailures.slice(0, 10).map((f) => f.name + "\uFF08" + f.id + "\uFF09\uFF1A" + f.message).join("\uFF1B")
      );
    const design = {
      schemaVersion: 1,
      fileKey: figma.fileKey || null,
      title: figma.root.name,
      pages,
      nodes,
      navigation,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      generator: "figma-offline-handoff/1.6.0"
    };
    post("complete", {
      design,
      previews,
      assets,
      warnings,
      assetFailures,
      selectedRootIds: roots.map((n) => n.id)
    });
  }
  figma.ui.onmessage = async (message) => {
    if (!message || message.channel !== bridgeChannel) return;
    if (message.type === "ready" || message.type === "get-state") {
      catalog(message.requestId);
      return;
    }
    if (message.type === "cancel") {
      cancelled = true;
      return;
    }
    if (message.type !== "export" || busy) return;
    busy = true;
    cancelled = false;
    runId = message.runId;
    try {
      await collect(message.options);
    } catch (e) {
      post("error", { message: e.message || String(e) });
    } finally {
      busy = false;
      catalog();
    }
  };
  figma.showUI(__html__.split("__HANDOFF_CHANNEL__").join(bridgeChannel), {
    width: 480,
    height: 700,
    themeColors: true
  });
})();
