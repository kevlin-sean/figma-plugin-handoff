// @ts-nocheck — formatted port of the previous script. Behavior is locked by tests.
import JSZipImpl from 'jszip'
import * as C from '../core/package'
import * as optimizerImpl from '../core/optimize-package'
import * as preview from '../core/preview-optimize'
import { setPreviewCodec } from '../core/preview-optimize'
import { viewerFiles } from 'virtual:viewer'
import { WEBP_CODEC_SOURCE, WEBP_WASM_BASE64 } from 'virtual:webp'

// Tests inject the Node JSZip, whose timers stay in the Node realm.
// The packaged UI falls back to the bundled copy.
const JSZip = (globalThis as { JSZip?: typeof JSZipImpl }).JSZip ?? JSZipImpl
if (!(globalThis as { JSZip?: typeof JSZipImpl }).JSZip) {
  ;(globalThis as { JSZip?: typeof JSZipImpl }).JSZip = JSZip
}
const optimizer =
  (globalThis as { HandoffOptimizer?: typeof optimizerImpl }).HandoffOptimizer ?? optimizerImpl

setPreviewCodec(WEBP_CODEC_SOURCE, WEBP_WASM_BASE64)

const BRIDGE_CHANNEL = '__HANDOFF_CHANNEL__';
const pendingState = new Map();
let stateRequestId = 0;
function send(message) {
  parent.postMessage({ pluginMessage: Object.assign({ channel: BRIDGE_CHANNEL }, message) }, '*');
}
function requestState() {
  const requestId = 'state-' + ++stateRequestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingState.delete(requestId);
      reject(
        Error('无法同步 Figma 选区。请关闭并重新运行插件，确认 code.js 和 ui.html 均已更新。'),
      );
    }, 5000);
    pendingState.set(requestId, { resolve, reject, timer });
    send({ type: 'get-state', requestId });
  });
}
const $ = (id: string) => document.getElementById(id)!
let state = { pages: [], selection: [], title: 'Figma' },
  baseline = null,
  run = null,
  working = false,
  downloadUrl = null;
const mode = () => document.querySelector('input[name=mode]:checked').value;
const scope = () => document.querySelector('input[name=scope]:checked').value;
function status(text, error = false, warning = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
  $('status').classList.toggle('warning', warning);
}
function lock(value) {
  working = value;
  document.querySelectorAll('input,select').forEach((el) => (el.disabled = value));
  $('export').disabled = value;
  $('cancel').hidden = !value;
  $('refreshSelection').disabled = value;
}
function hideDownload() {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  $('download').hidden = true;
  $('download').removeAttribute('href');
  $('failureDetails').hidden = true;
  $('failureDetails').open = false;
  $('failureList').textContent = '';
}
function scopeInfo() {
  $('selectionRow').hidden = mode() !== 'update' && scope() !== 'selection';
  $('selection').textContent =
    '当前选中：' + (state.selection.map((n) => n.name + ' [' + n.id + ']').join('、') || '无');
  if (mode() === 'update' && baseline) {
    const ids = new Set(baseline.design.nodes.map((n) => n.id));
    const matches = state.selection.filter((n) => ids.has(n.id));
    $('scopeInfo').textContent =
      `旧包匹配 ${matches.length}/${state.selection.length} 个目标。请选择互不包含的 Frame / Section。`;
  } else $('scopeInfo').textContent = '';
}
function modes() {
  const update = mode() === 'update';
  $('oldPanel').hidden = !update;
  $('scopeControls').hidden = update;
  $('export').textContent = update ? '更新选中画板并生成 ZIP' : '生成离线交付 ZIP';
  scopeInfo();
  namePreview();
  hideDownload();
}
document.querySelectorAll('input[name=mode]').forEach((el) => (el.onchange = modes));
document.querySelectorAll('input[name=scope]').forEach((el) => (el.onchange = scopeInfo));
async function readBaseline(file) {
  if (file.size > 300 * 1024 * 1024) throw Error('旧包超过 300MB，请拆分交付范围后再导入。');
  const zip = await JSZip.loadAsync(file),
    entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length > 30000) throw Error('旧包文件数量过多。');
  for (const f of entries) {
    C.safePath(f.name);
    if (f.unsafeOriginalName && f.unsafeOriginalName !== f.name) throw Error('旧包含非法路径');
  }
  const expanded = entries.reduce((n, f) => n + (f._data?.uncompressedSize || 0), 0);
  if (expanded > 1024 * 1024 * 1024) throw Error('旧包解压后超过 1GB。');
  const candidates = entries.filter((f) => /(^|\/)data\/design\.json$/.test(f.name));
  if (candidates.length !== 1) throw Error('ZIP 中应只有一份 data/design.json');
  const prefix = candidates[0].name.slice(0, -'data/design.json'.length);
  async function json(name) {
    const f = zip.file(prefix + name);
    if (!f) throw Error('缺少 ' + name);
    return JSON.parse(await f.async('string'));
  }
  const design = await json('data/design.json'),
    assets = await json('data/assets.json'),
    previews = await json('data/previews.json');
  const summary = C.validate(design, assets, previews);
  for (const name of ['index.html', 'viewer.js', 'viewer.css'])
    if (!zip.file(prefix + name)) throw Error('缺少离线查看器 ' + name);
  for (const a of assets) if (!zip.file(prefix + a.path)) throw Error('缺少切图 ' + a.path);
  for (const p of previews)
    for (const path of [p.path, ...(p.patches || []).map((q) => q.path)])
      if (!zip.file(prefix + path)) throw Error('缺少预览 ' + path);
  return { zip, prefix, design, assets, previews, summary, fileName: file.name };
}
$('oldFile').onchange = async () => {
  const file = $('oldFile').files[0];
  if (!file) return;
  lock(true);
  $('cancel').hidden = true;
  baseline = null;
  $('sameFile').checked = false;
  hideDownload();
  status('读取旧交付包…');
  try {
    baseline = await readBaseline(file);
    $('oldInfo').textContent =
      `${baseline.design.title || file.name} · ${baseline.summary.pages} Pages · ${baseline.summary.nodes} 图层 · ${baseline.summary.assets} 切图`;
    status('旧包已载入。在 Figma 中选中需要替换的 Frame / Section。');
  } catch (e) {
    $('oldInfo').textContent = '读取失败';
    status(e.message, true);
  } finally {
    lock(false);
    scopeInfo();
    namePreview();
  }
};
$('refreshSelection').onclick = async () => {
  if (working) return;
  $('refreshSelection').disabled = true;
  status('正在读取 Figma 当前选区…');
  try {
    await requestState();
    status('选区已同步。');
  } catch (e) {
    status(e.message, true);
  } finally {
    $('refreshSelection').disabled = false;
  }
};
$('export').onclick = async () => {
  if (working) return;
  try {
    const update = mode() === 'update';
    if (update && !baseline) throw Error('请先导入旧交付包 ZIP。');
    if (update && !$('sameFile').checked) throw Error('请确认旧包属于当前文件。');
    lock(true);
    $('cancel').hidden = true;
    status('正在同步 Figma 当前页面与选区…');
    await requestState();
    const pageIds = [...document.querySelectorAll('#pages input:checked')].map((el) => el.value);
    if (!update && scope() === 'pages' && !pageIds.length) throw Error('请至少选择一个 Page。');
    // Selection validity is checked against figma.currentPage.selection in code.js, not a UI cache.
    hideDownload();
    lock(true);
    run = {
      id: String(Date.now()) + '-' + Math.random().toString(36).slice(2),
      mode: mode(),
      upgradeViewer: $('upgradeViewer').checked,
      packageName: deliveryName(
        update ? baseline.design.title : state.title,
        update,
        $('packageName').value,
      ),
      files: new Map(),
      cancelled: false,
    };
    status('开始读取设计稿，请暂停编辑…');
    send({
      type: 'export',
      runId: run.id,
      options: {
        mode: run.mode,
        scope: scope(),
        pageIds,
        previewScale: Number($('previewScale').value),
        allowedRootIds: update ? baseline.design.nodes.map((n) => n.id) : undefined,
      },
    });
  } catch (e) {
    status(e.message, true);
    lock(false);
    run = null;
  }
};
$('cancel').onclick = () => {
  if (run) run.cancelled = true;
  send({ type: 'cancel' });
  status('正在取消，原交付包没有变化…');
};
const zipName = (title) => (title || 'Figma').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').slice(0, 90);
// Resolve the archive and folder name once, before exporting any design data.
function deliveryName(title, update, custom = '') {
  const raw = String(custom || '').trim();
  if (!raw) return zipName(title) + (update ? '-局部更新' : '-离线交付');
  const name = raw.replace(/\.zip$/i, '').trim();
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    /[\\/:*?"<>|\x00-\x1f]/.test(name) ||
    /[. ]$/.test(name)
  )
    throw Error('交付包名称无效：请勿使用路径分隔符、特殊文件名符号或末尾句点。');
  if (Array.from(name).length > 90) throw Error('交付包名称请控制在 90 个字符以内。');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    throw Error('该名称为系统保留名称，请换一个交付包名称。');
  return name;
}
function namePreview() {
  const update = mode() === 'update',
    title = update && baseline ? baseline.design.title : state.title;
  $('packageName').placeholder = deliveryName(title, update);
  try {
    const name = deliveryName(title, update, $('packageName').value);
    $('packageNamePreview').textContent = name + '.zip';
  } catch (e) {
    $('packageNamePreview').textContent = e.message;
  }
}
$('packageName').oninput = () => {
  const previous = !!downloadUrl;
  hideDownload();
  namePreview();
  if (previous) status('交付包名称已修改，请重新生成后下载。');
};
// Rename only the delivery root in the new archive; do not mutate imported
// ZipObjects (JSZip.clone shares them) or rewrite relative resource references.
function packageWithName(zip, prefix, name) {
  const target = name + '/',
    out = new JSZip();
  out.comment = zip.comment;
  for (const entry of Object.values(zip.files)) {
    if (prefix && entry.dir && (entry.name === prefix || prefix.startsWith(entry.name))) continue;
    const path = entry.name.startsWith(prefix)
      ? target + entry.name.slice(prefix.length)
      : entry.name;
    if (out.files[path]) throw Error('交付目录重命名发生路径冲突：' + path);
    const file = Object.assign(Object.create(Object.getPrototypeOf(entry)), entry, { name: path });
    out.files[path] = file;
  }
  return out;
}
function assetFailureReason(f) {
  if (/may not have any visible layers|no visible layers/i.test(f.message || ''))
    return f.source === 'auto'
      ? 'Figma 未能导出可见内容。请检查图层及父级的可见性、透明度、裁剪和蒙版。'
      : 'Figma 未能导出可见内容。请检查图层及父级的可见性、透明度、裁剪和蒙版；不需要该切图时移除 Export。';
  return f.message || 'Figma 未返回错误详情。';
}
function showExportDetails(failures, warnings = []) {
  $('failureDetails').hidden = !failures.length && !warnings.length;
  $('failureDetails').open = false;
  $('failureSummary').textContent = failures.length
    ? '切图失败明细（' + failures.length + '）'
    : '导出提示';
  $('failureList').textContent = [failures.map(assetFailureText).join('\n\n'), warnings.join('\n')]
    .filter(Boolean)
    .join('\n\n');
}
function assetFailureText(f, index) {
  return `${index + 1}. Page：${f.pageName}（${f.pageId}）\n区域：${f.regionName}（${f.regionId}）\n画板：${f.frameName}（${f.frameId}）\n切图：${f.nodeName}（${f.nodeId}） · ${f.format} · ${f.source === 'auto' ? '自动识别图标' : '图层 Export 设置'}\n图层路径：${(f.nodePath || []).map((n) => n.name + '（' + n.id + '）').join(' / ')}\n原因：${f.message}${assetFailureReason(f) !== f.message ? '\n建议：' + assetFailureReason(f) : ''}`;
}
async function buildPackage(message, job) {
  if (job.cancelled) throw Error('已取消。');
  const incoming = { design: message.design, assets: message.assets, previews: message.previews };
  if (typeof preview !== 'undefined')
    await preview.optimize(job.files, incoming.previews, {
      check() {
        if (job.cancelled) throw Error('已取消。');
      },
      progress: status,
      isShared:
        job.mode === 'update'
          ? async (bytes) => {
              for (const path of optimizer.references(baseline)) {
                if (!path.endsWith('.png')) continue;
                const file = baseline.zip.file(baseline.prefix + path);
                if (
                  !file ||
                  (file._data?.uncompressedSize !== undefined &&
                    file._data.uncompressedSize !== bytes.length)
                )
                  continue;
                if (preview.equalPixels(bytes, await file.async('uint8array'))) return true;
              }
              return false;
            }
          : null,
    });
  C.validate(incoming.design, incoming.assets, incoming.previews);
  const update = job.mode === 'update';
  let data = update ? C.merge(baseline, incoming, message.selectedRootIds) : C.clone(incoming);
  const zip = update ? baseline.zip.clone() : new JSZip();
  if (update) zip.files = Object.assign(Object.create(null), baseline.zip.files);
  const packageName = job.packageName || deliveryName(data.design.title, update);
  const prefix = update ? baseline.prefix : packageName + '/';
  if (update && !job.upgradeViewer && data.previews.some((p) => p.patches?.length)) {
    const js = await zip.file(prefix + 'viewer.js').async('string');
    if (!js.includes('p.patches'))
      throw Error('旧查看器不支持局部覆盖，请选最外层区域更新或重新首次导出。');
  }
  if (!update || job.upgradeViewer)
    for (const [name, body] of Object.entries(viewerFiles)) zip.file(prefix + name, body);
  if (!update) {
    zip.file(
      prefix + '使用说明.txt',
      '解压整个 ZIP 后双击 index.html。\n预览默认 2×，可选 1×/3×；仅新预览尝试无损压缩，独立切图保持原 SVG/PNG。\n左侧分页面、切图、颜色；支持 Page、画板和父子图层目录。\n点击图层仅显示橙色轮廓与宽高；悬停同画板另一图层显示两者距离和蓝色四边定位虚线，移开恢复宽高。空格+拖动平移，Ctrl/Command+滚轮缩放。\n右侧为属性、填充、边框、字体、阴影、代码模板、导出；无属性的模块隐藏。数值可双击选中复制，色块可切换颜色格式；px/pt/dp 为 1:1 逻辑单位展示。\n代码提供 CSS 及基础 Android/iOS 属性模板；复杂效果、交互和响应式由开发实现，变量与图片路径需接入项目。字体不分发。\n选中已导出切图，普通点击卡片选格式，Option/Alt+点击卡片或画布切图使用浏览器原生保存；沿用原文件字节和名称。\n切图沿用图层 SVG/PNG Export，同格式取首条；没有 Export 的小图标会自动导出一份 SVG，成组图标只切最外层。图片和插画不会自动切。跨画板按内容去重保留关联。\ndata/design.json 保存层级、位置、原生 CSS、布局、字体分段及颜色绑定；assets.json 保存切图设置与关联；previews.json 保存预览。\nX/Y 相对所属画板包围框原点。旋转/蒙版/非矩形按边界近似，距离不等于 CSS margin。\n局部更新替换整个所选 Frame/Section 子树，保留原位置与范围外内容，原 ZIP 保留。\n',
    );
  }
  for (const [path, bytes] of job.files) {
    C.safePath(path);
    if (zip.file(prefix + path)) throw Error('文件路径冲突，停止更新：' + path);
    zip.file(prefix + path, bytes);
  }
  const optimization = await optimizer.optimize(data, zip, prefix, {
    baseline: update ? baseline : null,
    check() {
      if (job.cancelled) throw Error('已取消。');
    },
    progress: status,
  });
  const exportedAt = new Date().toISOString();
  const dataFiles = {
    'data/design.json': data.design,
    'data/assets.json': data.assets,
    'data/previews.json': data.previews,
  };
  for (const [path, value] of Object.entries(dataFiles))
    zip.file(prefix + path, JSON.stringify(value));
  const payload = Object.assign({}, data.design, {
    assets: data.assets,
    previews: data.previews,
    exportedAt,
  });
  zip.file(
    prefix + 'data/design-data.js',
    'window.HANDOFF = ' +
      JSON.stringify(payload)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029') +
      ';\n',
  );
  const failures = message.assetFailures || [],
    warnings = message.warnings || [];
  // Failure diagnostics live only in this plugin session. Replace the previous
  // report with compact update metadata and remove our old generated failure log.
  zip.remove(prefix + '切图失败清单.txt');
  const report = {
    schemaVersion: 1,
    optimization,
    mode: job.mode,
    viewerUpdated: !!(update && job.upgradeViewer),
    exportedAt,
    scope: message.selectedRootIds,
    changes: data.changes || [],
    summary: C.validate(data.design, data.assets, data.previews),
    newFiles: [...job.files.keys()].filter((path) => zip.file(prefix + path)),
  };
  zip.file(prefix + 'data/update-report.json', JSON.stringify(report));
  for (const a of data.assets)
    if (!zip.file(prefix + a.path)) throw Error('打包缺少切图：' + a.path);
  for (const p of data.previews)
    for (const path of [p.path, ...(p.patches || []).map((q) => q.path)])
      if (!zip.file(prefix + path)) throw Error('打包缺少预览：' + path);
  const outputZip = packageWithName(zip, prefix, packageName);
  const blob = await outputZip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } },
    (m) => {
      if (job.cancelled) throw Error('已取消。');
      status('正在打包 ' + Math.round(m.percent) + '%');
    },
  );
  if (job.cancelled) throw Error('已取消。');
  downloadUrl = URL.createObjectURL(blob);
  $('download').href = downloadUrl;
  $('download').download = packageName + '.zip';
  $('download').hidden = false;
  $('download').textContent = failures.length ? '下载交付包 ZIP（有切图失败）' : '下载交付包 ZIP';
  showExportDetails(failures, warnings);
  status(
    `交付包已生成：${packageName}.zip\n${report.summary.pages} 页面 · ${report.summary.nodes} 图层 · ${report.summary.assets} 张切图 · ${(blob.size / 1024 / 1024).toFixed(2)} MB` +
      (optimization.sharedAssets.length
        ? `\n共享切图 ${optimization.sharedAssets.length} 份。`
        : '') +
      (failures.length
        ? '\n切图失败 ' + failures.length + ' 项，其余内容已打包。展开下方明细查看。'
        : warnings.length
          ? '\n有导出提示，可展开查看。'
          : ''),
    false,
    failures.length > 0,
  );
}
window.onmessage = async (event) => {
  const m = event.data?.pluginMessage;
  if (!m || m.channel !== BRIDGE_CHANNEL) return;
  if (m.type === 'catalog') {
    if (!Array.isArray(m.pages) || !Array.isArray(m.selection)) return;
    const first = !state.pages.length,
      known = new Set(state.pages.map((p) => p.id)),
      checked = new Set(
        [...document.querySelectorAll('#pages input:checked')].map((el) => el.value),
      );
    state = m;
    $('pages').replaceChildren();
    for (const p of m.pages) {
      const label = document.createElement('label'),
        input = document.createElement('input');
      input.type = 'checkbox';
      input.value = p.id;
      input.checked = first ? p.id === m.currentPage : known.has(p.id) && checked.has(p.id);
      input.disabled = working;
      label.append(input, document.createTextNode(p.name));
      $('pages').append(label);
    }
    scopeInfo();
    namePreview();
    $('connection').textContent = '已连接 Figma · v' + (m.version || '?');
    const pending = pendingState.get(m.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingState.delete(m.requestId);
      pending.resolve(m);
    }
    return;
  }
  const job = run;
  if (!job || m.runId !== job.id) return;
  try {
    if (m.type === 'asset-warning' && !job.cancelled)
      status(
        '切图未导出：' + (m.failure?.nodeName || '未知图层') + '。已记录，继续导出…',
        false,
        true,
      );
    if (m.type === 'progress') {
      if (!job.cancelled) status(m.message);
    }
    if (m.type === 'file' && !job.cancelled) {
      C.safePath(m.path);
      job.files.set(m.path, new Uint8Array(m.bytes));
    }
    if (m.type === 'error') {
      status(m.message, true);
      lock(false);
      run = null;
    }
    if (m.type === 'complete') {
      await buildPackage(m, job);
      lock(false);
      run = null;
    }
  } catch (e) {
    status(e.message, true);
    lock(false);
    run = null;
  }
};
window.addEventListener?.('focus', () => {
  if (!working) send({ type: 'get-state' });
});
namePreview();
send({ type: 'ready' });

const hooks = globalThis as typeof globalThis & {
  buildPackage?: typeof buildPackage
  readBaseline?: typeof readBaseline
  packageWithName?: typeof packageWithName
  baseline?: typeof baseline
}
Object.defineProperty(hooks, 'baseline', {
  configurable: true,
  get: () => baseline,
  set: (value) => {
    baseline = value
  },
})
hooks.buildPackage = buildPackage
hooks.readBaseline = readBaseline
hooks.packageWithName = packageWithName
