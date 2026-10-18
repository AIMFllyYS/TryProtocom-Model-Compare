"""Pin evaluator API runtimes without changing the user's global installations."""
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request
import zipfile

ROOT=Path(__file__).resolve().parents[2]
DEST=ROOT/'workbench/.runtime/benchmark-api-runtime'
NODE_VERSION='22.23.3'
NODE_ZIP_SHA='2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71'
PYTHON=Path('C:/Users/AIMFl/AppData/Roaming/uv/python/cpython-3.11.15-windows-x86_64-none/python.exe')

def main():
    DEST.mkdir(parents=True,exist_ok=True)
    filename=f'node-v{NODE_VERSION}-win-x64.zip'
    archive=DEST/filename
    source=f'https://nodejs.org/download/release/v{NODE_VERSION}/{filename}'
    if not archive.exists():
        with urllib.request.urlopen(source,timeout=90) as response:
            archive.write_bytes(response.read())
    actual=hashlib.sha256(archive.read_bytes()).hexdigest()
    assert actual==NODE_ZIP_SHA,'Official Node archive checksum mismatch'
    node=DEST/f'node-v{NODE_VERSION}-win-x64/node.exe'
    if not node.exists():
        with zipfile.ZipFile(archive) as z:
            for member in z.infolist():
                target=(DEST/member.filename).resolve()
                assert DEST.resolve() in target.parents,'Archive member outside evaluator runtime directory'
            z.extractall(DEST)
    versions={}
    for name,exe in [('python',PYTHON),('node',node)]:
        p=subprocess.run([str(exe),'--version'],capture_output=True,text=True,check=True,creationflags=subprocess.CREATE_NO_WINDOW)
        versions[name]=p.stdout.strip()
    manifest={'api_python':str(PYTHON),'api_node':str(node),'versions':versions,
              'node_source':source,'node_sha256':actual,'global_installations_changed':False}
    (DEST/'manifest.json').write_text(json.dumps(manifest,indent=2),'utf-8')
    print(json.dumps(manifest))

if __name__=='__main__':main()
