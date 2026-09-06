#!/usr/bin/env python3
"""Check rebuilt entrypoints, retained solo core, and saved validation results.
No public-network or physical-device acceptance is inferred by this check.
"""
from pathlib import Path
import hashlib, json, re, subprocess, sys
ROOT=Path(__file__).resolve().parents[1]
checks=[]
def check(name, condition):
    checks.append({'name':name,'passed':bool(condition)})
    if not condition: raise AssertionError(name)
html=(ROOT/'index.html').read_text(encoding='utf-8')
ascii_html=(ROOT/'ascii_start.html').read_text(encoding='utf-8')
check('Solo-mode source remains unchanged from 6.0.0', hashlib.sha256((ROOT/'src/base.html').read_bytes()).hexdigest()=='0bf06906d11e5d0ff2812ceceaeaa5ca31e40fd1c3f7e693be2367063c69d3aa')
check('ASCII is a complete independent copy with only its boot override', ascii_html==html.replace("const bootRender=new URLSearchParams(location.search).get('render');", "const bootRender='ascii'; // Independent zero-canvas startup entry."))
check('Built header and diagnostics are 6.1', '<b>v6.1</b>' in html and "version:'6.1.0'" in html)
check('Removed team-only buff revocation and obsolete UI speed label', 'enforceNoAIBuffs' not in html and '375 移速上限' not in html and 'syncD4Benefits' in html)
check('HTML uses embedded source with no mandatory module imports', not re.search(r'<script\b[^>]*\bsrc=',html) and 'class DoublesGame extends PongGame' in html)
count=0
for name in ['team_ai','team_ui','team_protocol','regression']:
    data=json.loads((ROOT/'validation'/f'{name}.json').read_text())
    rows=data.get('checks',data.get('tests',[]))
    check(name+' saved checks pass without page errors', bool(rows) and all(r.get('passed',r.get('pass',False)) for r in rows) and not data.get('errors') and not data.get('failure'))
    count+=len(rows)
check('All 246 functional assertions are present',count==246)
# Rebuild from included source and verify determinism.
subprocess.run([sys.executable,str(ROOT/'tools/build.py')],cwd=ROOT,check=True)
check('Entrypoints reproduce byte for byte',html==(ROOT/'index.html').read_text() and ascii_html==(ROOT/'ascii_start.html').read_text())
(ROOT/'validation/release.json').write_text(json.dumps({'checks':checks,'functionalAssertions':count,'networkAcceptance':False},ensure_ascii=False,indent=2))
print('PASS',len(checks),'release checks;',count,'functional assertions')
