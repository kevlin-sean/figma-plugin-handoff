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

// src/core/preview-optimize.ts
var preview_optimize_exports = {};
__export(preview_optimize_exports, {
  browserCompress: () => browserCompress,
  equalPixels: () => equalPixels,
  optimize: () => optimize,
  pngInfo: () => pngInfo,
  setPreviewCodec: () => setPreviewCodec
});
module.exports = __toCommonJS(preview_optimize_exports);
var codecSource;
var codecWasmBase64;
function setPreviewCodec(source, wasmBase64) {
  codecSource = source;
  codecWasmBase64 = wasmBase64;
}
function globalJSZip() {
  return globalThis.JSZip;
}
function pngInfo(bytes) {
  if (bytes.length < 33) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0) !== 2303741511 || v.getUint32(4) !== 218765834 || bytes[24] !== 8)
    return null;
  const width = v.getUint32(16), height = v.getUint32(20);
  if (!width || !height || width * height > 16 * 1024 * 1024) return null;
  for (let p = 8; p + 12 <= bytes.length; ) {
    const size = v.getUint32(p), end = p + 12 + size;
    if (end > bytes.length) return null;
    const tag = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    if (["iCCP", "cICP", "acTL"].includes(tag)) return null;
    if (tag === "gAMA" && (size !== 4 || v.getUint32(p + 8) !== 45455)) return null;
    if (tag === "cHRM" && (size !== 32 || [31270, 32900, 64e3, 33e3, 3e4, 6e4, 15e3, 6e3].some(
      (n, i) => v.getUint32(p + 8 + i * 4) !== n
    )))
      return null;
    if (tag === "IEND") return { width, height };
    p = end;
  }
  return null;
}
function equalPixels(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function workerMain() {
  let codec;
  self.onmessage = async ({ data }) => {
    try {
      if (data.type === "init") {
        codec = await self.HandoffWebPModule({ wasmBinary: new Uint8Array(data.wasm) });
        self.postMessage({ ready: true });
        return;
      }
      const rgba = new Uint8Array(data.rgba), input = codec._malloc(rgba.length), size = codec._malloc(4);
      let output = 0;
      if (!input || !size) throw Error("WebP memory allocation failed");
      try {
        codec.HEAPU8.set(rgba, input);
        output = codec._webp_encode_rgba(input, data.width, data.height, 100, 1, size);
        if (!output) throw Error("WebP lossless encode failed");
        const length = codec.HEAPU32[size >> 2], bytes = codec.HEAPU8.slice(output, output + length);
        self.postMessage({ bytes: bytes.buffer }, [bytes.buffer]);
      } finally {
        if (output) codec._webp_free(output);
        codec._free(input);
        codec._free(size);
      }
    } catch (e) {
      self.postMessage({ error: e.message || String(e) });
    }
  };
}
function createEncoder(check) {
  let worker = null, url = null, ready = null, disabled = false;
  function dispose() {
    worker?.terminate();
    worker = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
  }
  function request(data, transfer = []) {
    return new Promise((resolve, reject) => {
      const target = worker;
      let done = false;
      const finish = (error, value) => {
        if (done) return;
        done = true;
        clearInterval(poll);
        clearTimeout(timeout);
        target.removeEventListener("message", message);
        target.removeEventListener("error", failed);
        if (error) {
          dispose();
          reject(error);
        } else resolve(value);
      };
      const message = (e) => e.data.error ? finish(Error(e.data.error)) : finish(null, e.data), failed = (e) => finish(Error(e.message || "WebP worker failed"));
      const poll = setInterval(() => {
        try {
          check();
        } catch (e) {
          finish(e);
        }
      }, 75), timeout = setTimeout(() => finish(Error("WebP compression timeout")), 3e4);
      target.addEventListener("message", message);
      target.addEventListener("error", failed);
      target.postMessage(data, transfer);
    });
  }
  async function encode(rgba, width, height) {
    if (disabled) throw Error("WebP compression unavailable");
    check();
    try {
      if (!ready) {
        url = URL.createObjectURL(
          new Blob([codecSource, ";(", workerMain.toString(), ")();"], {
            type: "text/javascript"
          })
        );
        worker = new Worker(url);
        const wasm = Uint8Array.from(atob(codecWasmBase64), (c) => c.charCodeAt(0));
        ready = request({ type: "init", wasm: wasm.buffer }, [wasm.buffer]);
      }
      await ready;
      check();
      const copy = rgba.slice();
      const result = await request({ rgba: copy.buffer, width, height }, [copy.buffer]);
      return new Uint8Array(result.bytes);
    } catch (e) {
      disabled = true;
      dispose();
      throw e;
    }
  }
  return { encode, dispose };
}
async function browserCompress(bytes, encode, check) {
  const info = pngInfo(bytes);
  if (!info || bytes.length < 2048) return bytes;
  const canvas = document.createElement("canvas");
  canvas.width = info.width;
  canvas.height = info.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    canvas.width = canvas.height = 0;
    return bytes;
  }
  async function pixels(data, type) {
    const image = await createImageBitmap(new Blob([data], { type }));
    try {
      if (image.width !== info.width || image.height !== info.height)
        throw Error("Preview dimensions changed");
      ctx.clearRect(0, 0, info.width, info.height);
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, info.width, info.height).data;
    } finally {
      image.close();
    }
  }
  try {
    check();
    const original = await pixels(bytes, "image/png");
    for (let i = 3; i < original.length; i += 4) if (original[i] !== 255) return bytes;
    const webp = await encode(original, info.width, info.height);
    check();
    if (webp.length + 128 >= bytes.length * 0.96) return bytes;
    const decoded = await pixels(webp, "image/webp");
    check();
    return equalPixels(original, decoded) ? webp : bytes;
  } finally {
    canvas.width = canvas.height = 0;
  }
}
function decode64(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
function encode64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 32768)
    s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}
async function zipSize(bytes) {
  const zip = new (globalJSZip())();
  zip.file("preview", bytes);
  return (await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 9 }
  })).length;
}
async function optimize(files, previews, {
  check = () => {
  },
  progress = () => {
  },
  compress = null,
  archiveSize = globalJSZip() ? zipSize : null,
  isShared = null
} = {}) {
  if (!compress && (typeof Worker === "undefined" || typeof createImageBitmap === "undefined" || typeof codecSource === "undefined"))
    return;
  const assetPNGs = [...files].filter(([path]) => /^assets\/.*\.png$/.test(path)).map(([, bytes]) => bytes);
  const encoder = compress ? null : createEncoder(check), convert = compress || ((bytes) => browserCompress(bytes, encoder.encode, check));
  async function smaller(before, after) {
    if (after === before || after.length >= before.length) return false;
    if (!archiveSize) return true;
    try {
      const oldSize = await archiveSize(before), newSize = await archiveSize(after);
      check();
      return newSize + 2 < oldSize;
    } catch (e) {
      check();
      return false;
    }
  }
  async function attempt(bytes) {
    check();
    try {
      return await convert(bytes);
    } catch (e) {
      check();
      return bytes;
    }
  }
  try {
    for (let i = 0; i < previews.length; i++) {
      check();
      const p = previews[i], bytes = files.get(p.path);
      if (!bytes) continue;
      progress(`\u65E0\u635F\u538B\u7F29\u9884\u89C8 ${i + 1}/${previews.length}`);
      if (p.path.endsWith(".png")) {
        if (assetPNGs.some((a) => equalPixels(a, bytes)) || isShared && await isShared(bytes))
          continue;
        check();
        const result = await attempt(bytes);
        check();
        if (await smaller(bytes, result)) {
          const path = p.path.slice(0, -4) + ".webp";
          if (files.has(path)) continue;
          files.set(path, result);
          files.delete(p.path);
          p.path = path;
        }
      } else if (p.format === "section-composite" && p.path.endsWith(".svg")) {
        const doc = new DOMParser().parseFromString(
          new TextDecoder().decode(bytes),
          "image/svg+xml"
        );
        if (doc.querySelector("parsererror")) continue;
        let changed = false;
        for (const image of doc.querySelectorAll("image")) {
          const href = image.getAttribute("href"), m = href?.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
          if (!m) continue;
          const input = decode64(m[1]), result = await attempt(input);
          check();
          if (result !== input && result.length < input.length) {
            image.setAttribute("href", "data:image/webp;base64," + encode64(result));
            changed = true;
          }
        }
        if (changed) {
          const result = new TextEncoder().encode(new XMLSerializer().serializeToString(doc));
          if (await smaller(bytes, result)) files.set(p.path, result);
        }
      }
    }
  } finally {
    encoder?.dispose();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  browserCompress,
  equalPixels,
  optimize,
  pngInfo,
  setPreviewCodec
});
