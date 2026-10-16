"""Conservative static SVG identity, matching src/resource-identity.js."""
import json
import re

TAGS = set(('svg g defs symbol pattern marker use path rect circle ellipse line polyline polygon linearGradient radialGradient stop clipPath mask filter image title desc text tspan textPath feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence').split())
BAD_ENTITY = re.compile(r'&(?!amp;|lt;|gt;|quot;|apos;|#[0-9]+;|#x[0-9a-fA-F]+;)')
ID = re.compile(r'^[A-Za-z_][A-Za-z0-9_.:-]*$')


def canonical_svg(text):
    if not isinstance(text, str) or re.search(r'<!DOCTYPE|<!ENTITY|<!\[CDATA\[', text, re.I):
        return None
    tokens, ids, stack = [], {}, []
    cursor, roots = 0, 0

    def literal(value):
        if '<' in value or BAD_ENTITY.search(value) or (not stack and value.strip()):
            raise ValueError()
        tokens.append(['text', value])

    try:
        for match in re.finditer(r'<\?xml\s[\s\S]*?\?>|<!--[\s\S]*?-->|</?[A-Za-z][^<>]*>', text):
            literal(text[cursor:match.start()])
            cursor, raw = match.end(), match.group()
            if raw.startswith('<?'):
                if roots or stack:
                    raise ValueError()
                tokens.append(['xml', raw])
                continue
            if raw.startswith('<!--'):
                if '--' in raw[4:-3]:
                    raise ValueError()
                tokens.append(['comment', raw])
                continue
            close = re.fullmatch(r'</([A-Za-z][\w.-]*)\s*>', raw, re.ASCII)
            if close:
                if not stack or stack.pop() != close[1]:
                    raise ValueError()
                tokens.append(['close', close[1]])
                continue
            tag = re.fullmatch(r'<([A-Za-z][\w.-]*)([\s\S]*?)(/?)>', raw, re.ASCII)
            if not tag or tag[1] not in TAGS:
                raise ValueError()
            if not stack:
                roots += 1
                if tag[1] != 'svg' or roots != 1:
                    raise ValueError()
            attrs, names, body, at = [], set(), tag[2], 0
            pattern = re.compile(r'''\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')''', re.ASCII)
            while True:
                attr = pattern.match(body, at)
                if not attr:
                    break
                at = attr.end()
                name, value = attr[1], attr[2] if attr[2] is not None else attr[3]
                if name in names or re.match(r'on', name, re.I) or re.match(r'begin|end|aria-', name) or '\\' in value or BAD_ENTITY.search(value):
                    raise ValueError()
                if name == 'xmlns' and value != 'http://www.w3.org/2000/svg':
                    raise ValueError()
                if ':' in name and not (name == 'xmlns:xlink' and value == 'http://www.w3.org/1999/xlink') and name not in ('xlink:href', 'xml:space'):
                    raise ValueError()
                names.add(name)
                attrs.append([name, value])
                if name == 'id':
                    if not ID.fullmatch(value) or value in ids:
                        raise ValueError()
                    ids[value] = len(ids)
            if body[at:].strip():
                raise ValueError()
            tokens.append(['open', tag[1], attrs, bool(tag[3])])
            if not tag[3]:
                stack.append(tag[1])
        literal(text[cursor:])
        if stack or roots != 1:
            raise ValueError()

        def ref(value):
            if value not in ids:
                raise ValueError()
            return ['ref', ids[value]]

        for token in tokens:
            if token[0] != 'open':
                continue
            for attr in token[2]:
                name, value = attr
                if name == 'id':
                    attr[1] = ['id', ids[value]]
                    continue
                if name in ('href', 'xlink:href'):
                    if value.startswith('#'):
                        attr[1] = ref(value[1:])
                    elif not re.fullmatch(r'data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+', value):
                        raise ValueError()
                    continue
                parts, at = [], 0
                for match in re.finditer(r'''url\(\s*(['"]?)#([A-Za-z_][A-Za-z0-9_.:-]*)\1\s*\)''', value):
                    parts.extend([value[at:match.start()], ref(match[2])])
                    at = match.end()
                if parts:
                    parts.append(value[at:])
                    if any(isinstance(v, str) and re.search(r'url\s*\(', v, re.I) for v in parts):
                        raise ValueError()
                    attr[1] = parts
                elif re.search(r'url\s*\(', value, re.I):
                    raise ValueError()
        builtin = {'SourceGraphic', 'SourceAlpha', 'BackgroundImage', 'BackgroundAlpha', 'FillPaint', 'StrokePaint'}
        current = None
        for i, token in enumerate(tokens):
            if token[0] == 'open' and token[1] == 'filter':
                if current is not None:
                    raise ValueError()
                current = {'results': {}, 'end': i}
                if not token[3]:
                    for j in range(i + 1, len(tokens)):
                        if tokens[j][0] == 'open' and tokens[j][1] == 'filter':
                            raise ValueError()
                        if tokens[j][0] == 'close' and tokens[j][1] == 'filter':
                            current['end'] = j
                            break
                    else:
                        raise ValueError()
                for child in tokens[i + 1:current['end']]:
                    if child[0] != 'open':
                        continue
                    for name, value in child[2]:
                        if name == 'result':
                            if not child[1].startswith('fe') or not isinstance(value, str) or not ID.fullmatch(value) or value in builtin or value in current['results']:
                                raise ValueError()
                            current['results'][value] = len(current['results'])
            if token[0] == 'open':
                for attr in token[2]:
                    if attr[0] not in ('result', 'in', 'in2'):
                        continue
                    if current is None or not token[1].startswith('fe') or not isinstance(attr[1], str):
                        raise ValueError()
                    if attr[0] != 'result' and attr[1] in builtin:
                        continue
                    if attr[1] not in current['results']:
                        raise ValueError()
                    attr[1] = ['filter-ref', current['results'][attr[1]]]
            if current is not None and i == current['end']:
                current = None
        return json.dumps(tokens, ensure_ascii=False, separators=(',', ':'))
    except (ValueError, IndexError):
        return None
