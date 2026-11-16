"""Start the real API, check HTTP responses, and verify SIGTERM exits cleanly."""
import json,os,pathlib,signal,subprocess,time,urllib.request,urllib.error
root=pathlib.Path(__file__).resolve().parent.parent
env=os.environ.copy()
env.setdefault('APP_BASE_URL','http://127.0.0.1:5173')
port=env.get('SMOKE_PORT','18080')
env['BIND_ADDR']='127.0.0.1:'+port
env['ATTACHMENT_DIR']=str(root/'.data/smoke-attachments')
log=root/'.data/smoke.log';log.parent.mkdir(exist_ok=True)
with log.open('w') as out:
 p=subprocess.Popen([str(root/'backend/target/debug/wiki-api')],env=env,stdout=out,stderr=out)
 frontend=None
 try:
  for attempt in range(100):
   if p.poll() is not None: raise RuntimeError(log.read_text())
   try:
    with urllib.request.urlopen('http://127.0.0.1:'+port+'/health/live',timeout=1) as r:
     assert json.load(r)=={'status':'ok'};assert r.headers['X-Request-Id'];break
   except (OSError,urllib.error.URLError): time.sleep(.1)
  else: raise RuntimeError('API did not become live')
  with urllib.request.urlopen('http://127.0.0.1:'+port+'/health/ready',timeout=5) as r: assert json.load(r)=={'status':'ok'}
  try: urllib.request.urlopen('http://127.0.0.1:'+port+'/unknown')
  except urllib.error.HTTPError as e:
   assert e.code==404;assert json.load(e)['request_id']==e.headers['X-Request-Id']
  else: raise AssertionError('missing 404')
  # Vite uses 8080 by default; explicitly override target for this isolated smoke run.
  frontend=subprocess.Popen(['node','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','15173','--strictPort'],cwd=root/'frontend',env={**env,'API_PROXY_TARGET':'http://127.0.0.1:'+port},stdout=out,stderr=out)
  for attempt in range(100):
   try:
    with urllib.request.urlopen('http://127.0.0.1:15173/',timeout=1) as r: assert 'Build-a-Wiki' in r.read().decode()
    with urllib.request.urlopen('http://127.0.0.1:15173/health/ready',timeout=5) as r: assert json.load(r)=={'status':'ok'}
    break
   except (OSError,urllib.error.URLError): time.sleep(.1)
  else: raise RuntimeError('frontend proxy did not become ready')
 finally:
  if frontend is not None:
   frontend.terminate();frontend.wait(timeout=10)
  if p.poll() is None:p.send_signal(signal.SIGTERM)
  p.wait(timeout=10)
 assert p.returncode==0
assert 'graceful shutdown' in log.read_text()
print('HTTP live/ready/404/request_id/SIGTERM and Vite frontend proxy passed')
