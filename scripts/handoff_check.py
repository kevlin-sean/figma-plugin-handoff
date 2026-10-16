#!/usr/bin/env python3
"""Inspect and scope-check handoff ZIPs without printing full design data."""
import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import PurePosixPath
from resource_identity import canonical_svg


def load(path):
    z = zipfile.ZipFile(path)
    names = [n for n in z.namelist() if not n.endswith('/')]
    if len(names) != len(set(names)):
        raise ValueError('duplicate ZIP entries')
    for name in names:
        if name.startswith('/') or '\\' in name or '..' in PurePosixPath(name).parts:
            raise ValueError('unsafe ZIP path')
    candidates = [n for n in names if n == 'data/design.json' or n.endswith('/data/design.json')]
    if len(candidates) != 1:
        raise ValueError('expected exactly one data/design.json')
    prefix = candidates[0][:-len('data/design.json')]
    def read(file):
        return json.loads(z.read(prefix + file))
    design, assets, previews = read('data/design.json'), read('data/assets.json'), read('data/previews.json')
    nodes = {n['id']: n for n in design['nodes']}
    if len(nodes) != len(design['nodes']):
        raise ValueError('duplicate node IDs')
    for n in nodes.values():
        for field in ('parentId', 'frameId', 'regionId'):
            if n.get(field) and n[field] not in nodes:
                raise ValueError('missing node reference: ' + n['id'])
    for p in design['pages']:
        for node_id in p['regions']:
            if node_id not in nodes or not any(v['id'] == node_id for v in previews):
                raise ValueError('missing page region/preview')
    paths = [a['path'] for a in assets]
    for a in assets:
        if not a['nodeIds'] or any(i not in nodes for i in a['nodeIds']):
            raise ValueError('missing asset owner')
    for p in previews:
        paths.append(p['path'])
        paths.extend(q['path'] for q in p.get('patches', []))
    for file in ('index.html', 'viewer.js', 'viewer.css', 'data/design-data.js', *paths):
        if prefix + file not in names:
            raise ValueError('missing file: ' + file)
    for a in assets:
        if 'bytes' in a and a['bytes'] != z.getinfo(prefix + a['path']).file_size:
            raise ValueError('asset byte count mismatch: ' + a['path'])
    files = {name[len(prefix):]: name for name in names if name.startswith(prefix)}
    return {'zip': z, 'prefix': prefix, 'design': design, 'nodes': nodes,
            'assets': assets, 'previews': previews, 'files': files}


def summary(bundle):
    return {'pages': len(bundle['design']['pages']), 'regions': len(bundle['previews']),
            'nodes': len(bundle['nodes']), 'assets': len(bundle['assets']),
            'files': len(bundle['files']), 'title': bundle['design'].get('title')}


def descendants(nodes, roots):
    found = set(roots)
    while True:
        expanded = found | {n['id'] for n in nodes.values() if n.get('parentId') in found}
        if expanded == found:
            return found
        found = expanded


def digest(bundle, name):
    h = hashlib.sha256()
    with bundle['zip'].open(bundle['files'][name]) as stream:
        while data := stream.read(1024 * 1024):
            h.update(data)
    return h.digest()


def resource_digest(bundle, name):
    if name.lower().endswith('.svg') and bundle['zip'].getinfo(bundle['files'][name]).file_size <= 8 * 1024 * 1024:
        try:
            value = canonical_svg(bundle['zip'].read(bundle['files'][name]).decode('utf-8-sig'))
            if value is not None:
                return 'svg-local-ids:' + hashlib.sha256(value.encode('utf-8')).hexdigest()
        except UnicodeDecodeError:
            pass
    return 'bytes:' + digest(bundle, name).hex()


def diff(before, after, scope, allow_viewer_update=False, allow_resource_compaction=False):
    for node_id in scope:
        if node_id not in before['nodes'] or node_id not in after['nodes']:
            raise ValueError('scope ID must exist in both packages: ' + node_id)
    old_scope, new_scope = descendants(before['nodes'], scope), descendants(after['nodes'], scope)
    changed = [i for i in before['nodes'].keys() | after['nodes'].keys()
               if before['nodes'].get(i) != after['nodes'].get(i)]
    outside = [i for i in changed if (i in before['nodes'] and i not in old_scope) or (i not in before['nodes'] and i not in new_scope)]
    moved = [i for i in scope if any(before['nodes'][i]['absoluteBoundingBox'][k] != after['nodes'][i]['absoluteBoundingBox'][k] for k in ('x', 'y'))]
    mutable = {'data/design.json', 'data/design-data.js', 'data/assets.json', 'data/previews.json', 'data/update-report.json', '切图失败清单.txt'}
    viewer_files = {'index.html', 'viewer.js', 'viewer.css', 'spacing.js'}
    if allow_viewer_update:
        mutable |= viewer_files
    file_changes = [name for name in before['files'] if name not in after['files'] or digest(before, name) != digest(after, name)]
    def resource_paths(bundle):
        paths = {a['path'] for a in bundle['assets']}
        for p in bundle['previews']:
            paths.add(p['path'])
            paths.update(q['path'] for q in p.get('patches', []))
        return paths
    old_resources, new_resources = resource_paths(before), resource_paths(after)
    def allowed_removal(name):
        return (allow_resource_compaction and name not in after['files'] and name not in new_resources
                and name.startswith(('assets/', 'previews/'))
                and (name in old_resources or re.fullmatch(r'(assets|previews)/r-[a-z0-9]+-[a-z0-9]+-[a-zA-Z0-9_-]+\.(png|svg)', name)))
    unexpected = [name for name in file_changes if name not in mutable and not allowed_removal(name)]
    page_changes = before['design']['pages'] != after['design']['pages']
    region_ids = {before['nodes'][i]['regionId'] for i in scope}
    old_previews = {p['id']: p for p in before['previews']}
    new_previews = {p['id']: p for p in after['previews']}
    def preview_value(bundle, preview):
        if not allow_resource_compaction or preview is None:
            return preview
        value = json.loads(json.dumps(preview))
        value['path'] = resource_digest(bundle, value['path'])
        for patch in value.get('patches', []):
            patch['path'] = resource_digest(bundle, patch['path'])
        return value
    preview_changes = [i for i in old_previews.keys() | new_previews.keys()
                       if i not in region_ids and preview_value(before, old_previews.get(i)) != preview_value(after, new_previews.get(i))]
    def external_refs(bundle):
        refs = {}
        for asset in bundle['assets']:
            for node_id in asset['nodeIds']:
                if node_id in before['nodes'] and node_id not in old_scope:
                    props = {k: v for k, v in asset.items() if k not in ('nodeIds', 'uses', 'frameId', 'regionId')}
                    if allow_resource_compaction:
                        props.pop('id', None)
                        props.pop('bytes', None)
                        props['path'] = resource_digest(bundle, asset['path'])
                    refs.setdefault(node_id, []).append(json.dumps(props, sort_keys=True))
        return {k: sorted(set(v) if allow_resource_compaction else v) for k, v in refs.items()}
    asset_refs_changed = external_refs(before) != external_refs(after)
    return {'ok': not (outside or unexpected or moved or page_changes or preview_changes or asset_refs_changed), 'scope': scope,
            'changed_nodes': len(changed), 'out_of_scope_nodes': len(outside),
            'out_of_scope_examples': sorted(outside)[:20], 'moved_roots': moved,
            'pages_changed': page_changes, 'outside_preview_changes': preview_changes, 'outside_asset_refs_changed': asset_refs_changed, 'old_file_changes': file_changes,
            'unexpected_old_file_changes': unexpected, 'viewer_file_changes': [f for f in file_changes if f in viewer_files],
            'new_files': len(after['files'].keys() - before['files'].keys()),
            'after': summary(after)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    inspect = sub.add_parser('inspect'); inspect.add_argument('package')
    compare = sub.add_parser('diff'); compare.add_argument('before'); compare.add_argument('after')
    compare.add_argument('--scope', nargs='+', required=True)
    compare.add_argument('--allow-viewer-update', action='store_true', help='Allow only the fixed viewer files to change')
    compare.add_argument('--allow-resource-compaction', action='store_true', help='Allow identical resource reuse and removal of unreferenced generated resources; verify outside-scope bytes and metadata')
    args = parser.parse_args()
    try:
        if args.action == 'inspect':
            report = {'ok': True, **summary(load(args.package))}
        else:
            report = diff(load(args.before), load(args.after), args.scope, args.allow_viewer_update, args.allow_resource_compaction)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report['ok'] else 1
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False))
        return 2

if __name__ == '__main__':
    sys.exit(main())
