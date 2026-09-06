#!/usr/bin/env python3
"""Rebuild reproducibility and saved-result integrity, not online acceptance."""
from pathlib import Path
import hashlib,json,re,subprocess,sys
ROOT=Path(__file__).resolve().parents[1];checks=[]
def check(name,ok):
 checks.append({'name':name,'passed':bool(ok)})
 if not ok:raise AssertionError(name)
html=(ROOT/'index.html').read_text();ascii_html=(ROOT/'ascii_start.html').read_text()
check('Solo/base source is byte-identical to prior release',hashlib.sha256((ROOT/'src/base.html').read_bytes()).hexdigest()=='0bf06906d11e5d0ff2812ceceaeaa5ca31e40fd1c3f7e693be2367063c69d3aa')
check('ASCII entry differs only by its startup preference',ascii_html==html.replace("const bootRender=new URLSearchParams(location.search).get('render');","const bootRender='ascii'; // Independent zero-canvas startup entry."))
check('Visible and diagnostic version is 6.3','<b>v6.3</b>' in html and "version:'6.3.0'" in html)
check('Team protocol is v5','const D4 = Object.freeze({version:5,' in html)
check('Shared perks retained while controller is bounded','speedRatio:.66' in html and 'perception:.140' in html and 'All four seats have identical long-paddle eligibility' in html)
check('Team motion/tactics included in validated checkpoints','teamwork:cloneJSON(this.botTeam||{})' in html and 'if(!validD4Tactics(a.tactics))return false;' in html and 'this.botTeam=cloneJSON(a.teamwork||{})' in html)
check('HTML has no mandatory imported script tags',not re.search(r'<script\b[^>]*\bsrc=',html))
count=0
for name in ['tactical_ai','team_ai','team_protocol','team_ui','regression','balance_benchmark','full_matches']:
 d=json.loads((ROOT/'validation'/f'{name}.json').read_text());rows=d.get('checks',d.get('tests',[]));count+=len(rows)
 check(name+' saved checks pass',bool(rows) and all(x.get('passed',x.get('pass',False)) for x in rows) and not d.get('errors') and not d.get('failure') and not d.get('partial'))
check('297 distinct assertions counted once',count==297)
check('Report discloses censored and extended observations','29 场结束' in (ROOT/'TEST_REPORT.md').read_text() and '180 秒' in (ROOT/'TEST_REPORT.md').read_text())
check('UI describes actual controller speed','Math.round(PC_PADDLE_SPEED*D4_AI.speedRatio)' in html and '66%' in html)
subprocess.run([sys.executable,str(ROOT/'tools/build.py')],check=True,cwd=ROOT)
check('Bundled sources rebuild identical entrypoints',html==(ROOT/'index.html').read_text() and ascii_html==(ROOT/'ascii_start.html').read_text())
subprocess.run(['node','--check',str(ROOT/'validation/compiled.js')],check=True)
check('Inline JavaScript passes node syntax check',True)
(ROOT/'validation/release.json').write_text(json.dumps({'checks':checks,'functionalAssertions':count,'networkAcceptance':False,'entrypointSHA256':hashlib.sha256((ROOT/'index.html').read_bytes()).hexdigest()},ensure_ascii=False,indent=2))
print('PASS',len(checks),'release checks;',count,'functional assertions')
