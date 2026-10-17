"""Evaluator-only pinned renderer smoke; never enrolled as a model benchmark."""
import hashlib
import argparse
import json
import os
from pathlib import Path
import subprocess
import shutil
import time
import urllib.request
import psutil

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT/'reports/2026-10-03-official-unattended/video-environment-smoke'
PACKAGE = ROOT/'workbench/.runtime/overnight-tools/node_modules/hyperframes'

def main():
    global DEST
    parser = argparse.ArgumentParser()
    parser.add_argument('--with-audio', action='store_true')
    parser.add_argument('--production-profile', action='store_true')
    parser.add_argument('--complex-profile', action='store_true')
    args = parser.parse_args()
    if args.complex_profile:args.production_profile=True
    if args.with_audio:
        DEST = DEST.parent/'video-environment-audio-smoke'
    if args.production_profile:
        args.with_audio=True
        DEST=DEST.parent/('video-environment-complex-smoke' if args.complex_profile else 'video-environment-1080p-smoke')
        if args.complex_profile and (DEST/'result.json').exists():
            print(json.dumps({'status':'existing_diagnostic_retained','result':str(DEST/'result.json')}));return
        available=psutil.virtual_memory().available
        if available<(3.5 if args.complex_profile else 2.5)*1024**3:
            print(json.dumps({'status':'deferred_low_memory','available_bytes':available}));return
    DEST.mkdir(parents=True, exist_ok=True)
    gsap = DEST/'gsap-3.14.2.min.js'
    if not gsap.exists():
        with urllib.request.urlopen('https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js', timeout=30) as response:
            gsap.write_bytes(response.read())
    source = (PACKAGE/'dist/templates/blank/index.html').read_text('utf-8')
    source = source.replace('https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js', './gsap-3.14.2.min.js')
    duration = '20' if args.production_profile else ('4' if args.with_audio else '1')
    width,height=(1920,1080) if args.production_profile else (640,360)
    fps=30 if args.production_profile else 24
    source = source.replace('1920',str(width)).replace('1080',str(height)).replace('data-duration="10"',f'data-duration="{duration}"')
    source = source.replace('font-size: 72px','font-size: 32px').replace('>Title<','>Renderer diagnostic<')
    source = source.replace('// Example: tl.fromTo', 'tl.fromTo')
    source = source.replace('window.__timelines["main"]', 'window.__timelines = window.__timelines || {};\n      window.__timelines["main"]')
    if args.production_profile:
        source=source.replace('window.__timelines = window.__timelines || {};',
                              'tl.to("#title", { x: 120, duration: 19.8, ease: "none" }, 0);\n      window.__timelines = window.__timelines || {};')
    if args.with_audio:
        shutil.copyfile(ROOT/'reports/2026-10-03-overnight-preflight/tts-smoke.wav', DEST/'tts-smoke.wav')
        source = source.replace('<h1 id="title"', '<audio id="narration" src="tts-smoke.wav" data-start="0" data-duration="3.864" data-track-index="1" data-volume="1"></audio>\n      <h1 id="title"')
    complex_metadata={}
    if args.complex_profile:
        from video_complex_fixture import add_complex_scene
        source,complex_metadata=add_complex_scene(source,DEST)
    (DEST/'index.html').write_text(source, 'utf-8')
    node=ROOT/'workbench/.runtime/benchmark-api-runtime/node-v22.23.3-win-x64/node.exe'
    base = [str(node) if args.complex_profile else 'node', str(PACKAGE/'bin/hyperframes.mjs')]
    report = {'purpose':'evaluator environment diagnostic only', 'formal_enrollment':False,
              'hyperframes_version':json.loads((PACKAGE/'package.json').read_text('utf-8'))['version'],
              'gsap_version':'3.14.2', 'gsap_sha256':hashlib.sha256(gsap.read_bytes()).hexdigest(),
              'render_workers':1, 'layout_changed':False, 'steps':[]}
    report.update(complex_metadata)
    if args.complex_profile:
        report.update(status='running',diagnostic_pid=os.getpid(),diagnostic_created_at=psutil.Process().create_time())
        (DEST/'result.json').write_text(json.dumps(report,indent=2),'utf-8')
    report['audio_integration'] = args.with_audio
    report['production_profile'] = args.production_profile
    report['available_memory_before']=psutil.virtual_memory().available
    steps = [('check', ['check', str(DEST)]),
             ('render', ['render',str(DEST),'--output',str(DEST/'diagnostic.mp4'), '--fps',str(fps),
                         '--quality','draft','--workers','1','--low-memory-mode','--no-browser-gpu'])]
    for name, command_args in steps:
        started = time.monotonic()
        with (DEST/(name+'.stdout.log')).open('wb') as out, (DEST/(name+'.stderr.log')).open('wb') as err:
            proc = subprocess.Popen(base+command_args,cwd=DEST,stdin=subprocess.DEVNULL,stdout=out,stderr=err,
                                    creationflags=subprocess.CREATE_NO_WINDOW)
            minimum_available=psutil.virtual_memory().available;peak_process_rss=0
            try:
                while proc.poll() is None:
                    if time.monotonic()-started>600:raise TimeoutError('Renderer diagnostic exceeded 10 minutes')
                    minimum_available=min(minimum_available,psutil.virtual_memory().available)
                    if args.complex_profile and minimum_available<1.5*1024**3:
                        raise MemoryError('Diagnostic stopped: available memory below 1.5 GiB; model queue retained')
                    try:
                        parent=psutil.Process(proc.pid)
                        peak_process_rss=max(peak_process_rss,sum(p.memory_info().rss for p in [parent]+parent.children(recursive=True)))
                    except psutil.NoSuchProcess:pass
                    time.sleep(.5)
            except BaseException as error:
                subprocess.run(['taskkill','/PID',str(proc.pid),'/T','/F'],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW)
                proc.wait()
                report.update(status='stopped',error=str(error),passed=False)
                (DEST/'result.json').write_text(json.dumps(report,indent=2),'utf-8')
                raise
        report['steps'].append({'name':name,'exit_code':proc.returncode,'seconds':round(time.monotonic()-started,2),
                                'minimum_available_memory':minimum_available,'peak_renderer_tree_rss':peak_process_rss})
        (DEST/'result.json').write_text(json.dumps(report,indent=2),'utf-8')
        if proc.returncode:print(json.dumps(report));return
    probe = subprocess.run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(DEST/'diagnostic.mp4')],
                           capture_output=True,text=True,check=True,creationflags=subprocess.CREATE_NO_WINDOW)
    report['ffprobe'] = json.loads(probe.stdout)
    if args.with_audio:
        assert any(s['codec_type']=='audio' for s in report['ffprobe']['streams']), 'Rendered MP4 has no audio stream'
        assert abs(float(report['ffprobe']['format']['duration'])-float(duration))<.15, 'Unexpected integrated duration'
    video=next(s for s in report['ffprobe']['streams'] if s['codec_type']=='video')
    assert (video['width'],video['height'])==(width,height)
    assert video['avg_frame_rate']==f'{fps}/1'
    report['passed'] = True
    report['status'] = 'complete'
    (DEST/'result.json').write_text(json.dumps(report,indent=2),'utf-8')
    print(json.dumps({'passed':True,'result':str(DEST/'result.json')}))

if __name__=='__main__':main()
