"""Run browser acceptance against a fresh random schema in TEST_DATABASE_URL."""
import os,pathlib,subprocess,time,urllib.request,urllib.parse,uuid
root=pathlib.Path(__file__).resolve().parent.parent
base=os.environ['TEST_DATABASE_URL']
schema='e2e_'+uuid.uuid4().hex
subprocess.run(['psql',base,'-v','ON_ERROR_STOP=1','-c',f'CREATE SCHEMA {schema}'],check=True)
parts=urllib.parse.urlsplit(base);query=urllib.parse.parse_qsl(parts.query)+[('options','-csearch_path='+schema)]
url=urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))
password=uuid.uuid4().hex
config={**os.environ,'DATABASE_URL':url,'APP_BASE_URL':'http://127.0.0.1:15173','BIND_ADDR':'127.0.0.1:18080','ATTACHMENT_DIR':str(root/'.data/e2e-attachments'),'API_PROXY_TARGET':'http://127.0.0.1:18080','E2E_PASSWORD':password}
processes=[];success=False
(root/'.data').mkdir(exist_ok=True)
with (root/'.data/e2e.log').open('w') as log:
 try:
  subprocess.run([str(root/'backend/target/debug/migrate')],env=config,check=True)
  subprocess.run([str(root/'backend/target/debug/bootstrap'),'root'],input=password,text=True,env=config,check=True)
  processes.append(subprocess.Popen([str(root/'backend/target/debug/wiki-api')],env=config,stdout=log,stderr=log))
  processes.append(subprocess.Popen(['node','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','15173','--strictPort'],cwd=root/'frontend',env=config,stdout=log,stderr=log))
  for _ in range(100):
   if any(p.poll() is not None for p in processes):raise RuntimeError('server exited: .data/e2e.log')
   try:
    urllib.request.urlopen('http://127.0.0.1:15173/health/ready',timeout=1).close();break
   except OSError:time.sleep(.1)
  else:raise RuntimeError('servers not ready')
  subprocess.run(['npx','playwright','test'],cwd=root/'frontend',env=config,check=True)
  success=True
 finally:
  for p in processes:p.terminate()
  for p in processes:p.wait(timeout=10)
  if success:subprocess.run(['psql',base,'-v','ON_ERROR_STOP=1','-c',f'DROP SCHEMA {schema} CASCADE'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  else:print('Failed test schema retained:',schema)
