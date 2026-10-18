# Figma 离线交付插件

本地 Figma 插件，版本 1.6.0。从设计稿导出离线 HTML ZIP（预览、图层、标注、切图、颜色、JSON）。不访问网络，不改原稿，不调用模型。用户说明在 `README.md`。改完行为跑 `pnpm test`。

Figma 导入的是构建结果 `dist/manifest.json`，不是源码。`dist/` 不进版本库。

## 新功能改哪里

| 要加的能力 | 改这些文件 |
|---|---|
| 读取新的 Figma 图层字段、Export、预览 | `src/plugin/code.ts`。节点属性放进 `fields`，随 `serialize` 进 `design.nodes` |
| 导出选项、进度、下载、ZIP 目录 | `src/ui/main.ts`、`src/ui/index.html`、`src/ui/styles.css` |
| 包校验、路径、局部更新合并 | `src/core/package.ts` |
| 切图去重 | `src/core/optimize-package.ts`。静态 SVG 身份还要同步改 `src/core/resource-identity.ts` 和 `scripts/resource_identity.py` |
| 预览无损 WebP | `src/core/preview-optimize.ts`。编解码器仍用 `vendor/webp-codec.js` 与 `vendor/webp-codec.wasm`，由 UI 调用 `setPreviewCodec` |
| 交付包里的页面、样式、交互 | `src/viewer/viewer.ts`、`viewer.css`、`index.html` |
| 间距与坐标 | `src/viewer/spacing.ts` |

沙箱只收集数据。打 ZIP、去重、压缩都在插件面板里完成。查看器只读包内数据，不能在打开 `index.html` 时再向 Figma 要数据。

## 三条运行边界

1. **沙箱** `src/plugin/code.ts`：有 `figma`，没有 DOM。这是唯一去掉 `// @ts-nocheck`、会真正被 `tsc` 检查的文件。保持只读，不要 `figma` 写操作。
2. **面板** `src/ui/main.ts`：iframe，有 DOM，没有 `figma`。通过 `parent.postMessage` 通信。
3. **查看器** `src/viewer/viewer.ts`：打进 ZIP 的经典脚本。数据来自 `window.HANDOFF`，间距来自 `window.HandoffSpacing`。

桥消息必须带 `channel`。面板源码里的通道是字面量 `__HANDOFF_CHANNEL__`。`code.ts` 在 `figma.showUI` 之前把它替换成本次随机通道，并丢掉通道不匹配的消息。新增消息时两边一起加，测试会先替换这个占位符再执行面板脚本。

现有方向：

- 面板 → 沙箱：`ready`、`get-state`、`cancel`、`export`
- 沙箱 → 面板：`catalog`、`progress`、`file`、`asset-warning`、`error`、`complete`

`design.schemaVersion` 目前是 `1`。破坏包结构时再升版本，并同时改 `code.ts` 里的 `generator`、`package.json` 的 `version` 和 `README.md`。

## 导出并发与页面勾选

`collect` 每次开始时重建两个限额：`limitExport` 共 4 个槽，`limitSection` 同时只合成 1 个 Section。`exportAsync` 在 JS 线程外渲染，返回前大 PNG 一直占内存。槽位按输出像素计：不少于 1600 万像素占满 4 槽，不少于 800 万占 2 槽，其余占 1 槽。SVG 切图按 1 槽。同一图层的多种格式按顺序导出，不同图层共享槽位。

切图身份（`iconMemo`、`graphicMemo`、`fragmentMemo`）要在第一次 `exportAsync` 之前单线程算完，再并行导出。预览失败调用 `haltExport`，之后的 `check()` 让其余任务停下来；`settleAll` 等已发出的任务结束，再抛出第一个错误。取消仍只看 `cancelled`。

面板在页面 id 列表不变时不要重建 `#pages` 里的勾选框，否则选区刷新会丢掉正在取消的那一次点击。名称可以原地更新。当前选区与 Pages 互斥：选中当前选区会取消全部 Page 勾选；勾选 Page 会切回 Pages，Pages 可多选，并刷新「已选 N / M 个 Page」。局部更新隐藏选区单选和 Pages 范围，仍显示当前选区。

`clean()` 把 symbol 写成 `MIXED`，非有限数字写成 `null`，`-0` 写成 `0`。对象仍走 JSON，避免把宿主 getter 和函数写进包。

## 不能改掉的构建约定

`scripts/build.mjs` 用 esbuild。`package.json` 是 `"type": "module"`，所以给 Node `require` 的产物必须是 `.cjs`。

- 查看器 `viewer.ts` 用 `bundle: false` 输出。不要加 `import` / `export`，也不要包进 IIFE。测试用 `vm` 执行后直接调用顶层函数，例如 `cssData(n)`。
- `spacing.ts` 可以有导出。构建出 `dist/spacing.cjs`（测试 `require`）并复制为 `dist/spacing.js`（ZIP 和 `vm`）。文件末尾要保留 `module.exports = HandoffSpacing` 和 `window.HandoffSpacing = HandoffSpacing`。`vm` 里的 `window` 不是脚本自己的全局对象。
- 打进 ZIP 的查看器只有 `index.html`、`viewer.css`、`viewer.js`、`spacing.js`。名单在 `virtual:viewer`。不要把 `spacing.cjs`、`code.js`、`ui.html` 放进交付包。
- 面板优先用测试注入的 `globalThis.JSZip` 和 `globalThis.HandoffOptimizer`，没有再使用打包进去的副本。注入的是 Node 领域的对象，换掉会让 SVG 去重和 ZIP 在 `vm` 里失败。
- 面板 bundle 顶部的 `setImmediate` 垫片留给浏览器里的 JSZip。不要删。
- 预览压缩在 Worker 里。Node 测试不设置 codec；缺 Worker、`createImageBitmap` 或 codec 时直接跳过。
- `manifest.json` 由构建写到 `dist/manifest.json`，`main` 是 `code.js`，`ui` 是 `ui.html`。不要在仓库根目录再放一份。
- `networkAccess.allowedDomains` 保持 `none`。新功能不能发请求，也不能把新域名写进 manifest。

`src/ui/main.ts` 末尾把 `baseline`、`buildPackage`、`readBaseline`、`packageWithName` 挂到 `globalThis`，供测试调用。改面板时留着这些钩子。

`src/core`、`src/ui/main.ts`、`src/viewer` 上的 `// @ts-nocheck` 是移植时留下的。不要为了“修类型”整文件删掉。新的沙箱逻辑写在 `code.ts` 里，让 `pnpm typecheck` 检查它。

## 测试与校验

```bash
pnpm test        # 先构建，再 node --test tests/*.test.cjs
pnpm typecheck
```

测试读 `dist/`，不读 `src/` 的 TypeScript。只改源码、不构建，测试仍在跑旧产物。

- 纯逻辑断言对应 `dist/core/*.cjs` 和 `dist/spacing.cjs`。
- 沙箱、面板、查看器用 `vm` 跑 `dist/code.js`、`dist/ui.js`、`dist/viewer.js`、`dist/spacing.js`。
- `scripts/handoff_check.py` 对比两次 ZIP。SVG 归一化必须与 `scripts/resource_identity.py`、`src/core/resource-identity.ts` 三者一致。改其中一处就要改另外两处，并跑 `tests/resource-identity.test.cjs`。

行为变更优先补已有的 `tests/*.test.cjs`，不要另起一套框架。断言锁住的是导出结果和查看器全局函数，不是源码格式。

## 改完核对

1. 新字段从 `code.ts` 进 `design.json` 后，查看器只读已写入的数据，不假设 Figma 仍在。
2. 局部更新只替换选中的 Frame / Section 子树，范围外的节点和仍被引用的资源保持原字节。
3. 失败明细留在当前插件会话，不写进 ZIP，也不写进 `data/update-report.json`。
4. `pnpm test` 通过后再让 Figma 重新运行插件。已经导入过时，重新构建即可；换了目录要再导入 `dist/manifest.json`。
5. 页面勾选在目录刷新后保持。预览和切图并行仍受 4 槽与单 Section 合成限额约束。
