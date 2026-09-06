#!/usr/bin/env python3
"""Release reproducibility and saved-test integrity, not public-network approval."""
from pathlib import Path
import hashlib,json,re,subprocess,sys
ROOT=Path(__file__).resolve().parents[1];checks=[]
def check(name,ok):
    checks.append({'name':name,'passed':bool(ok)})
    if not ok:raise AssertionError(name)
html=(ROOT/'index.html').read_text();ascii_html=(ROOT/'ascii_start.html').read_text()
check('Solo-mode source byte-identical to 6.1/6.0',hashlib.sha256((ROOT/'src/base.html').read_bytes()).hexdigest()=='0bf06906d11e5d0ff2812ceceaeaa5ca31e40fd1c3f7e693be2367063c69d3aa')
check('Independent ASCII differs only by its cold-start preference',ascii_html==html.replace("const bootRender=new URLSearchParams(location.search).get('render');","const bootRender='ascii'; // Independent zero-canvas startup entry."))
check('Visible version and diagnostics are 6.2','<b>v6.2</b>' in html and "version:'6.2.0'" in html)
check('Team protocol gated at v4','const D4 = Object.freeze({version:4,' in html)
check('Tactical state validated, snapshotted and restored','if(!validD4Tactics(a.tactics))return false;' in html and 'tactics:cloneJSON(this.ensureD4Tactics())' in html and 'this.botTactics=cloneJSON(a.tactics)' in html)
check('Self-contained HTML without mandatory imported scripts',not re.search(r'<script\b[^>]*\bsrc=',html))
count=0
for name in ['attack','team_ai','team_protocol','team_ui','regression']:
    d=json.loads((ROOT/'validation'/f'{name}.json').read_text());rows=d.get('checks',d.get('tests',[]));count+=len(rows)
    check(name+' final saved checks pass',bool(rows) and all(r.get('passed',r.get('pass',False)) for r in rows) and not d.get('errors') and not d.get('failure'))
check('285 functional assertions counted once',count==285)
subprocess.run([sys.executable,str(ROOT/'tools/build.py')],cwd=ROOT,check=True)
check('Included source rebuilds identical entrypoints',html==(ROOT/'index.html').read_text() and ascii_html==(ROOT/'ascii_start.html').read_text())
(ROOT/'validation/release.json').write_text(json.dumps({'checks':checks,'functionalAssertions':count,'networkAcceptance':False},ensure_ascii=False,indent=2))
print('PASS',len(checks),'release checks;',count,'functional assertions')
