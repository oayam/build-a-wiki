"""Actual full-disk and process-interruption test in a private 1MiB tmpfs."""
from db_env import database_env
import hashlib,http.client,http.cookiejar,json,os,pathlib,shutil,subprocess,tempfile,time,urllib.parse,urllib.request,uuid
root=pathlib.Path(__file__).resolve().parent.parent;base=os.environ['TEST_DATABASE_URL'];schema='fault_'+uuid.uuid4().hex;parts=urllib.parse.urlsplit(base);url=urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode([('options','-csearch_path='+schema)])));disk=pathlib.Path(tempfile.mkdtemp(prefix='wiki-fault-'));origin='http://127.0.0.1:18082';env={**os.environ,'DATABASE_URL':url,'APP_BASE_URL':origin,'BIND_ADDR':'127.0.0.1:18082','ATTACHMENT_DIR':str(disk),'LOG_LEVEL':'warn'};server=None;mounted=False

def sql(q,db=url):return subprocess.check_output(['psql','-AtX','-v','ON_ERROR_STOP=1','-c',q],env=database_env(db),text=True).strip()
def start():
 global server
 server=subprocess.Popen([str(root/'backend/target/debug/wiki-api')],env=env,stdout=log,stderr=log)
 for _ in range(100):
  try:urllib.request.urlopen(origin+'/health/ready',timeout=1);return
  except OSError:time.sleep(.1)
 raise RuntimeError('server not ready')
jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar));csrf=''
def call(path,method='GET',body=None):
 req=urllib.request.Request(origin+'/api/v1'+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Content-Type':'application/json','Origin':origin,'X-CSRF-Token':csrf})
 with opener.open(req,timeout=10) as r:return json.load(r)
log=(root/'.data/fault-drill.log').open('w');sql('CREATE SCHEMA '+schema,base)
try:
 subprocess.run(['mount','-t','tmpfs','-o','size=1m','tmpfs',str(disk)],check=True);mounted=True
 subprocess.run([str(root/'backend/target/debug/migrate')],env=env,check=True);password=uuid.uuid4().hex;subprocess.run([str(root/'backend/target/debug/bootstrap'),'root'],input=password,text=True,env=env,check=True);start();u=call('/auth/login','POST',{'username':'root','password':password});csrf=u['csrf_token'];k=call('/knowledge-bases','POST',{'name':'故障恢复'});p=call('/knowledge-bases/'+k['id']+'/pages','POST',{'request_id':str(uuid.uuid4()),'title':'已提交版本','schema_version':1,'body':{'type':'doc','content':[{'type':'paragraph'}]}})
 data=b'x'*(2*1024*1024);digest=hashlib.sha256(data).hexdigest();path='/api/v1/pages/'+p['id']+'/attachments?'+urllib.parse.urlencode({'request_id':str(uuid.uuid4()),'name':'disk-full.bin','sha256':digest});cookie='; '.join(c.name+'='+c.value for c in jar)
 req=urllib.request.Request(origin+path,data=data,method='POST',headers={'Cookie':cookie,'Origin':origin,'X-CSRF-Token':csrf})
 try:opener.open(req,timeout=10);raise AssertionError('full disk upload unexpectedly succeeded')
 except urllib.error.HTTPError as e:assert e.code==503,e.code
 except urllib.error.URLError as e:
  if not isinstance(e.reason,(ConnectionResetError,BrokenPipeError)):raise
 assert call('/pages/'+p['id'])['current_revision_id']==p['revision_id']
 # Start another upload but kill the server before completing the body.
 conn=http.client.HTTPConnection('127.0.0.1',18082,timeout=10);path='/api/v1/pages/'+p['id']+'/attachments?'+urllib.parse.urlencode({'request_id':str(uuid.uuid4()),'name':'interrupted.bin','sha256':digest});conn.putrequest('POST',path)
 for k,v in {'Cookie':cookie,'Origin':origin,'X-CSRF-Token':csrf,'Content-Length':str(len(data))}.items():conn.putheader(k,v)
 conn.endheaders();conn.send(data[:32768])
 for _ in range(100):
  if list(disk.iterdir()):break
  time.sleep(.05)
 assert list(disk.iterdir()),'upload never reached disk';server.kill();server.wait();conn.close();sql("UPDATE attachments SET created_at=now()-interval '2 hours' WHERE status='pending'; UPDATE jobs SET available_at=now()");start()
 for _ in range(100):
  if sql("SELECT count(*) FROM attachments WHERE status='pending'")=='0':break
  time.sleep(.1)
 assert sql("SELECT count(*) FROM attachments WHERE status='pending'")=='0';assert not list(disk.iterdir());assert call('/pages/'+p['id'])['current_revision_id']==p['revision_id']
 subprocess.run([str(root/'backend/target/debug/maintenance'),'on'],env=env,check=True,stdout=subprocess.DEVNULL)
 try:call('/pages/'+p['id']+'/visit','PUT');raise AssertionError('maintenance accepted write')
 except urllib.error.HTTPError as e:assert e.code==503
 subprocess.run([str(root/'backend/target/debug/maintenance'),'off'],env=env,check=True,stdout=subprocess.DEVNULL)
 result={'passed':['actual ENOSPC upload failure','committed revision survives failure','SIGKILL during partial upload','restart compensates pending rows and files','maintenance rejects writes'],'storage':'private tmpfs 1MiB'};(root/'docs/fault-drill.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
finally:
 if server and server.poll() is None:server.terminate();server.wait(timeout=15)
 log.close()
 if mounted:subprocess.run(['umount',str(disk)],check=True)
 shutil.rmtree(disk);sql('DROP SCHEMA '+schema+' CASCADE',base)
