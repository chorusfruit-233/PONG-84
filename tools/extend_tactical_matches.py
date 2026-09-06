#!/usr/bin/env python3
"""Extend censored 180-second self-play samples to a first-to-7 result.
The original comparison-window observations remain untouched and are checked at 180s.
"""
import json, os, shutil, statistics
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'validation';checks=[];errors=[]
data=json.loads((OUT/'balance_benchmark.json').read_text())
rows=[r for r in data['rows'] if r['version']=='6.3' and r['policy']=='aggressive'];extended=[]
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=os.environ.get('PONG_BROWSER') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-gpu'])
 try:
  p=b.new_page();p.on('pageerror',lambda e:errors.append(str(e)));p.set_content((ROOT/'ascii_start.html').read_text())
  p.evaluate('()=>{'+(ROOT/'tools/tactical_fixture.js').read_text()+'}')
  for r in rows:
   if r['finished']:continue
   more=p.evaluate('(job)=>runMatch(job)',dict(formation=r['formation'],seed=r['seed'],benefits=r['benefits'],policy='aggressive',limit=360))
   extended.append(more);checks.append({'name':f"Same first 180s reproduced: {r['formation']}/{r['seed']}/{r['benefits']}",'passed':more['scoreAt180']==r['score']})
   print(r['formation'],r['seed'],r['benefits'],'180s:',more['scoreAt180'],'final:',more['score'],'seconds:',more['seconds'],flush=True)
 finally:b.close()
full=[]
for r in rows:
 matching=next((m for m in extended if (m['formation'],m['seed'],m['benefits'])==(r['formation'],r['seed'],r['benefits'])),None)
 full.append(matching or r)
for form in ['split','depth']:
 group=[r for r in full if r['formation']==form]
 checks.append({'name':'All first-to-7 samples finish by 360 simulated seconds: '+form,'passed':len(group)==16 and all(r['finished'] and r['valid'] for r in group)})
 print(form,{'completed':sum(r['finished'] for r in group),'medianSeconds':statistics.median(r['seconds'] for r in group),'minSeconds':min(r['seconds'] for r in group),'maxSeconds':max(r['seconds'] for r in group)},flush=True)
checks.append({'name':'No uncaught browser errors in extended samples','passed':not errors})
(OUT/'full_matches.json').write_text(json.dumps({'checks':checks,'rows':full,'extended':extended,'errors':errors,
 'method':'Same seeds replayed where the fixed 180-second window censored a match. Exact 180-second score checked. Extended observation limit 360 simulated seconds; no rule changes or artificial scores.'},ensure_ascii=False,indent=2))
if any(not c['passed'] for c in checks):raise SystemExit(1)
