import esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const watch = process.argv.includes('--watch')

function read(file) {
  return fs.readFileSync(path.join(root, file))
}

function virtualModules() {
  return {
    name: 'handoff-virtual',
    setup(build) {
      build.onResolve({ filter: /^virtual:webp$/ }, () => ({ path: 'webp', namespace: 'handoff' }))
      build.onResolve({ filter: /^virtual:viewer$/ }, () => ({ path: 'viewer', namespace: 'handoff' }))
      build.onLoad({ filter: /.*/, namespace: 'handoff' }, (args) => {
        if (args.path === 'webp') {
          const source = read('vendor/webp-codec.js').toString('utf8')
          const wasm = read('vendor/webp-codec.wasm').toString('base64')
          return {
            loader: 'ts',
            contents: `export const WEBP_CODEC_SOURCE = ${JSON.stringify(source)};\nexport const WEBP_WASM_BASE64 = ${JSON.stringify(wasm)};\n`,
          }
        }
        const viewerFiles = {}
        for (const name of ['index.html', 'viewer.css', 'viewer.js', 'spacing.js']) {
          viewerFiles[name] = fs.readFileSync(path.join(dist, name), 'utf8')
        }
        return {
          loader: 'ts',
          contents: `export const viewerFiles: Record<string, string> = ${JSON.stringify(viewerFiles)};\n`,
        }
      })
    },
  }
}

async function buildViewer() {
  await esbuild.build({
    entryPoints: [path.join(root, 'src/viewer/spacing.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'HandoffSpacing',
    platform: 'browser',
    target: 'es2020',
    outfile: path.join(dist, 'spacing.cjs'),
    footer: {
      js: [
        "if (typeof module === 'object' && module.exports) module.exports = HandoffSpacing;",
        "if (typeof window === 'object' && window) window.HandoffSpacing = HandoffSpacing;",
      ].join('\n'),
    },
  })
  await esbuild.build({
    entryPoints: [path.join(root, 'src/viewer/viewer.ts')],
    bundle: false,
    platform: 'browser',
    target: 'es2020',
    outfile: path.join(dist, 'viewer.js'),
  })
  fs.copyFileSync(path.join(dist, 'spacing.cjs'), path.join(dist, 'spacing.js'))
  fs.copyFileSync(path.join(root, 'src/viewer/index.html'), path.join(dist, 'index.html'))
  fs.copyFileSync(path.join(root, 'src/viewer/viewer.css'), path.join(dist, 'viewer.css'))
}

async function buildCore() {
  const entries = ['package', 'resource-identity', 'optimize-package', 'preview-optimize']
  await esbuild.build({
    entryPoints: entries.map((name) => path.join(root, 'src/core', name + '.ts')),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'es2020',
    outdir: path.join(dist, 'core'),
    outExtension: { '.js': '.cjs' },
  })
}

async function buildPlugin() {
  await esbuild.build({
    entryPoints: [path.join(root, 'src/plugin/code.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outfile: path.join(dist, 'code.js'),
  })
}

async function buildUi() {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/ui/main.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    banner: {
      js: 'var setImmediate = function (fn) { var args = Array.prototype.slice.call(arguments, 1); return setTimeout(function () { fn.apply(null, args); }, 0); };',
    },
    plugins: [virtualModules()],
  })
  const js = result.outputFiles[0].text
  fs.writeFileSync(path.join(dist, 'ui.js'), js)
  const css = fs.readFileSync(path.join(root, 'src/ui/styles.css'), 'utf8')
  const html = fs
    .readFileSync(path.join(root, 'src/ui/index.html'), 'utf8')
    .replace('/* CSS */', css)
    .replace('<!-- SCRIPTS -->', '<script>\n' + js + '\n</script>')
  fs.writeFileSync(path.join(dist, 'ui.html'), html)
}

function writeManifest() {
  const manifest = {
    name: 'Figma 离线交付 · Offline Handoff',
    id: 'figma-offline-handoff-local',
    api: '1.0.0',
    editorType: ['figma'],
    main: 'code.js',
    ui: 'ui.html',
    documentAccess: 'dynamic-page',
    networkAccess: { allowedDomains: ['none'] },
  }
  fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}

async function buildAll() {
  fs.mkdirSync(dist, { recursive: true })
  fs.mkdirSync(path.join(dist, 'core'), { recursive: true })
  fs.rmSync(path.join(dist, 'viewer'), { recursive: true, force: true })
  await buildViewer()
  await Promise.all([buildCore(), buildPlugin(), buildUi()])
  writeManifest()
  const uiBytes = fs.statSync(path.join(dist, 'ui.html')).size
  console.log(JSON.stringify({ uiBytes, manifest: 'dist/manifest.json', code: 'dist/code.js', ui: 'dist/ui.html' }))
}

let building = false
let queued = false
async function rebuild() {
  if (building) {
    queued = true
    return
  }
  building = true
  try {
    await buildAll()
  } catch (error) {
    console.error(error)
  } finally {
    building = false
    if (queued) {
      queued = false
      await rebuild()
    }
  }
}

await rebuild()
if (watch) {
  fs.watch(path.join(root, 'src'), { recursive: true }, () => {
    rebuild()
  })
  console.log('watching src/')
}
