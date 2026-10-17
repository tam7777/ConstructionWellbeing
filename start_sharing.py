"""Start this project's public VM Quick Tunnel without a system service."""
import json
import re
import subprocess
import time
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parent
EMAIL=None
STATE=ROOT/'sharing-processes.json'


def owned(pid,executable):
    try:
        return str(executable).encode() in Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
    except OSError:
        return False


def main():
    binary=ROOT/'tools/cloudflared'
    python=ROOT/'.venv/bin/python'
    adapter=ROOT/'sharing.py'
    if STATE.exists():
        previous=json.loads(STATE.read_text())
        if (owned(previous['proxy_pid'],adapter) and owned(previous['cloudflared_pid'],binary)
                and previous.get('allowed_email')==EMAIL):
            print(json.dumps(previous));return
        raise SystemExit('A previous sharing record exists. Check its processes before starting another tunnel.')
    with urllib.request.urlopen('http://127.0.0.1:8765/',timeout=10) as response:
        assert response.status==200
    started=[]
    try:
        with (ROOT/'sharing-adapter.log').open('ab') as log:
            proxy=subprocess.Popen([str(python),str(adapter)],cwd=ROOT,stdin=subprocess.DEVNULL,
                stdout=log,stderr=log,start_new_session=True)
        started.append((proxy,adapter))
        # A 503 is expected until the generated public origin is recorded.
        for _ in range(30):
            if proxy.poll() is not None:raise RuntimeError('Sharing adapter failed to start.')
            try:
                urllib.request.urlopen('http://127.0.0.1:8766/',timeout=1).close();break
            except urllib.error.HTTPError as error:
                if error.code==503:break
            except OSError:
                time.sleep(.1)
        tunnel_log=ROOT/'sharing-cloudflared.log'
        with tunnel_log.open('w') as log:
            tunnel=subprocess.Popen([str(binary),'tunnel','--no-autoupdate','--url',
                'http://127.0.0.1:8766','--protocol','http2'],
                cwd=ROOT,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
        started.append((tunnel,binary))
        origin=None
        for _ in range(160):
            if tunnel.poll() is not None:raise RuntimeError('Cloudflare exited. Check sharing-cloudflared.log.')
            logs=tunnel_log.read_text()
            match=re.search(r'https://[a-z0-9-]+\.trycloudflare\.com',logs)
            if match:
                origin=match.group()
                (ROOT/'sharing-origin.json').write_text(json.dumps({'origin':origin}))
            if origin and 'Registered tunnel connection' in logs:
                state={'origin':origin,'allowed_email':EMAIL,'proxy_pid':proxy.pid,
                       'cloudflared_pid':tunnel.pid,'started_at':time.time()}
                STATE.write_text(json.dumps(state,indent=2))
                print(json.dumps(state));return
            time.sleep(.25)
        raise RuntimeError('Cloudflare did not become ready within 40 seconds.')
    except BaseException:
        for process,executable in started:
            if process.poll() is None and owned(process.pid,executable):process.terminate()
        raise


if __name__=='__main__':main()
