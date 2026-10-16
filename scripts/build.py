#!/usr/bin/env python3
"""Build a self-contained Figma UI. No package install or network required."""
from pathlib import Path
import json, base64
root = Path(__file__).resolve().parent.parent
viewer = {p.name: p.read_text() for p in (root / 'viewer').iterdir() if p.is_file()}
def script(s):
    return s.replace('</script', '<\\/script')
shell = (root / 'src/ui-shell.html').read_text()
parts = [root/'vendor/jszip.min.js', root/'src/package-core.js', root/'src/resource-identity.js', root/'src/optimize-package.js', root/'src/preview-optimize.js', root/'src/ui.js']
shell = shell.replace('<!-- SCRIPTS -->', '<script>const WEBP_CODEC_SOURCE = ' + json.dumps((root/'vendor/webp-codec.js').read_text()).replace('<','\\u003c') + '; const WEBP_WASM_BASE64 = ' + json.dumps(base64.b64encode((root/'vendor/webp-codec.wasm').read_bytes()).decode('ascii')) + '; const VIEWER = ' + json.dumps(viewer, ensure_ascii=False).replace('<','\\u003c') + ';<\/script>'.replace('<\\/','</') + '\n' + '\n'.join('<script>'+script(p.read_text())+'</script>' for p in parts))
(root/'ui.html').write_text(shell)
print(json.dumps({'ui_bytes': (root/'ui.html').stat().st_size, 'viewer_files': list(viewer)}, ensure_ascii=False))
