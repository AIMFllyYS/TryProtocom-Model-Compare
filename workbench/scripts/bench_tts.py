"""Fixed Mandarin benchmark TTS adapter. Edge TTS -> PCM WAV via local FFmpeg."""
import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile

def main():
    p=argparse.ArgumentParser();p.add_argument('--text',required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--voice',default='zh-CN-YunxiNeural');args=p.parse_args()
    args.out=args.out.resolve();args.out.parent.mkdir(parents=True,exist_ok=True)
    edge=shutil.which('edge-tts');ffmpeg=shutil.which('ffmpeg')
    if not edge or not ffmpeg:raise RuntimeError('edge-tts and ffmpeg must be available')
    # Intermediate files remain next to the requested output, within the task workspace.
    with tempfile.TemporaryDirectory(prefix='.bench-tts-',dir=args.out.parent) as tmp:
        mp3=Path(tmp)/'speech.mp3'
        subprocess.run([edge,'--voice',args.voice,'--rate','+15%','--text',args.text,'--write-media',str(mp3)],
                       check=True,timeout=90,creationflags=subprocess.CREATE_NO_WINDOW)
        subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-y','-i',str(mp3),'-ar','48000','-ac','1','-c:a','pcm_s16le',str(args.out)],
                       check=True,timeout=30,creationflags=subprocess.CREATE_NO_WINDOW)
    print(args.out)

if __name__=='__main__':main()
