"""Read-only Restart Manager query for processes holding a specified workspace file."""
import argparse
import ctypes as c
from ctypes import wintypes as w
import json
from pathlib import Path

class UniqueProcess(c.Structure):
    _fields_=[('pid',w.DWORD),('started',w.FILETIME)]

class ProcessInfo(c.Structure):
    _fields_=[('process',UniqueProcess),('app',w.WCHAR*256),('service',w.WCHAR*64),
              ('kind',c.c_int),('status',w.ULONG),('session',w.DWORD),('restartable',w.BOOL)]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('file',type=Path);args=parser.parse_args()
    path=args.file.resolve();assert path.is_file()
    api=c.WinDLL('Rstrtmgr');session=w.DWORD();key=c.create_unicode_buffer(33)
    code=api.RmStartSession(c.byref(session),0,key)
    if code:raise OSError(code,'RmStartSession')
    try:
        files=(w.LPCWSTR*1)(str(path))
        code=api.RmRegisterResources(session,1,files,0,None,0,None)
        if code:raise OSError(code,'RmRegisterResources')
        needed=w.UINT();count=w.UINT();reasons=w.DWORD()
        code=api.RmGetList(session,c.byref(needed),c.byref(count),None,c.byref(reasons))
        if code not in [0,234]:raise OSError(code,'RmGetList')
        infos=(ProcessInfo*needed.value)();count.value=needed.value
        code=api.RmGetList(session,c.byref(needed),c.byref(count),infos,c.byref(reasons))
        if code:raise OSError(code,'RmGetList')
        rows=[]
        for info in infos[:count.value]:
            started=((info.process.started.dwHighDateTime<<32)+info.process.started.dwLowDateTime)/1e7-11644473600
            rows.append(dict(pid=info.process.pid,created_at=started,app=info.app,service=info.service))
        print(json.dumps({'path':str(path),'holders':rows},ensure_ascii=True))
    finally:api.RmEndSession(session)

if __name__=='__main__':main()
