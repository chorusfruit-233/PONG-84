#!/usr/bin/env python3
"""Measure PONG-84 rendering with Chromium GPU acceleration disabled.

This injects a local HTML file into a blank page; it is not a navigation or
network end-to-end test. An in-memory auto-return fixture keeps the ball moving.
The source HTML is never modified. Python 3.10+ and Playwright are required.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import shutil
import statistics
import sys
import time

FLAGS = ['--disable-gpu', '--disable-gpu-compositing',
         '--disable-accelerated-2d-canvas', '--disable-webgl',
         '--disable-software-rasterizer']

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('html', nargs='?', type=Path, default=Path(__file__).resolve().parents[1] / 'index.html')
    parser.add_argument('--seconds', type=float, default=10)
    parser.add_argument('--cpu-rate', type=float, default=1, help='DevTools CPU throttling rate, 1 to 20')
    parser.add_argument('--profile', choices=['auto', 'smooth', 'eco'], default='auto')
    parser.add_argument('--browser', help='Optional path to Chromium/Chrome executable')
    parser.add_argument('--out', type=Path, help='Optional JSON result file')
    args = parser.parse_args()
    if not args.html.is_file():
        parser.error(f'HTML file does not exist: {args.html}')
    if not 2 <= args.seconds <= 120 or not 1 <= args.cpu_rate <= 20:
        parser.error('--seconds must be 2–120 and --cpu-rate must be 1–20')
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('Install the test dependency: python -m pip install playwright', file=sys.stderr)
        return 2
    executable = args.browser or shutil.which('chromium') or shutil.which('chromium-browser') or shutil.which('google-chrome')
    errors: list[str] = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=executable, headless=True, args=FLAGS)
            try:
                gpu = browser.new_browser_cdp_session().send('SystemInfo.getInfo')['gpu']['featureStatus']
                context = browser.new_context(viewport={'width': 1366, 'height': 768}, device_scale_factor=1)
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.evaluate('''() => {
                    // Cold ASCII boot: seed browser preferences before executing the unchanged HTML.
                    const store=new Map([['pong84.ui4.settings',JSON.stringify({renderMode:'ascii'})]]);
                    Object.defineProperty(window,'localStorage',{configurable:true,value:{
                        getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)}});
                    window.__ctxCalls=0;
                    const original=HTMLCanvasElement.prototype.getContext;
                    HTMLCanvasElement.prototype.getContext=function(...a){
                        window.__ctxCalls++;return original.apply(this,a);
                    };
                }''')
                page.set_content(args.html.read_text(encoding='utf-8'))
                page.wait_for_timeout(200)
                session = context.new_cdp_session(page)
                session.send('Performance.enable')
                session.send('Emulation.setCPUThrottlingRate', {'rate': args.cpu_rate})
                page.evaluate('''profile => {
                    game.audio.tone=()=>{};game.audio.enabled=false;
                    game.setSetting('renderMode','ascii');ui.applyRenderMode();
                    game.setSetting('renderProfile',profile);
                    game.setSetting('mode','pvp');game.setSetting('score',99);
                    game.resetMatch();game.phase=Phase.PLAYING;game.elapsed=0;
                    game.prepareServe('left');game.launchServe('left');
                    game.ball.vy=350;game.ball.vx=1150;game.emitUi();
                    const originalMove=game.movePaddles.bind(game);
                    game.movePaddles=dt=>{
                        originalMove(dt);
                        for(const paddle of [game.left,game.right])
                            paddle.y=clamp(game.ball.y-paddle.height*(.5+.24*Math.sin(game.elapsed*2.1)),0,WORLD.height-paddle.height);
                    };
                    window.__drawTimes=[];window.__drawCosts=[];
                    const originalRender=game.render.bind(game);
                    game.render=()=>{const t=performance.now();originalRender();
                        window.__drawCosts.push(performance.now()-t);window.__drawTimes.push(t);};
                    game.lastTs=performance.now();game.accumulator=0;
                    if(!game.raf)game.raf=requestAnimationFrame(game.loop);
                }''', args.profile)
                page.wait_for_timeout(1100)
                page.evaluate('window.__drawTimes.length=0;window.__drawCosts.length=0;')
                def metrics() -> dict[str, float]:
                    return {item['name']: item['value'] for item in session.send('Performance.getMetrics')['metrics']}
                before = metrics()
                started = time.monotonic()
                page.wait_for_timeout(args.seconds * 1000)
                seconds = time.monotonic() - started
                after = metrics()
                data = page.evaluate('({times:__drawTimes,costs:__drawCosts,canvasCalls:__ctxCalls,diagnostics:PONG84.diagnostics()})')
                costs = data.pop('costs')
                times = data.pop('times')
                intervals = [y - x for x, y in zip(times, times[1:])]
                def percentile(values: list[float], q: float) -> float | None:
                    ordered = sorted(values)
                    return round(ordered[int((len(ordered)-1)*q)], 4) if ordered else None
                result = {
                    'browser': browser.version, 'viewport': [1366, 768],
                    'navigation_tested': False, 'auto_return_fixture': True, 'cold_ascii_boot': True, 'storage_fixture': True,
                    'gpu_status': gpu, 'flags': FLAGS, 'cpu_throttle': args.cpu_rate,
                    'seconds': round(seconds, 3), 'submissions': len(times),
                    'submission_hz': round(len(times)/seconds, 2),
                    'render_js_mean_ms': round(statistics.mean(costs), 4) if costs else None,
                    'render_js_p95_ms': percentile(costs, .95),
                    'submit_interval_p95_ms': percentile(intervals, .95),
                    'submit_interval_max_ms': round(max(intervals), 3) if intervals else None,
                    'renderer_metrics_delta_s': {key: round(after.get(key,0)-before.get(key,0),4)
                        for key in ['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration']},
                    **data, 'errors': errors,
                    'note': 'Submission rate is not physical presentation FPS. JS draw time excludes browser layout/paint. CPU throttling is not an old-computer hardware equivalence.'
                }
                output = json.dumps(result, ensure_ascii=False, indent=2)
                print(output)
                if args.out:
                    args.out.parent.mkdir(parents=True, exist_ok=True)
                    args.out.write_text(output, encoding='utf-8')
                return 0 if not errors else 1
            finally:
                browser.close()
    except Exception as error:
        print(f'Benchmark could not complete: {error}', file=sys.stderr)
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
