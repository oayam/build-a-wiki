from db_env import database_env
"""100k Chinese pages / 100 users / 20 concurrent sessions in an isolated schema."""
import threading
import concurrent.futures,http.cookiejar,json,os,pathlib,platform,statistics,subprocess,time,urllib.parse,urllib.request,uuid
root=pathlib.Path(__file__).resolve().parent.parent;base=os.environ['TEST_DATABASE_URL'];schema='bench_'+uuid.uuid4().hex
parts=urllib.parse.urlsplit(base);url=urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(urllib.parse.parse_qsl(parts.query)+[('options','-csearch_path='+schema)])))
env={**os.environ,'DATABASE_URL':url,'PGDATABASE':url,'APP_BASE_URL':'http://127.0.0.1:18081','BIND_ADDR':'127.0.0.1:18081','ATTACHMENT_DIR':str(root/'.data/benchmark-files'),'LOG_LEVEL':'warn'}
def sql(q,conn=base):return subprocess.check_output(['psql','-AtX','-v','ON_ERROR_STOP=1','-c',q],env=database_env(conn),text=True)
sql('CREATE SCHEMA '+schema);password=uuid.uuid4().hex
subprocess.run([str(root/'backend/target/debug/migrate')],env=env,check=True);subprocess.run([str(root/'backend/target/debug/bootstrap'),'root'],input=password,text=True,env=env,check=True)
seed="""
BEGIN;
INSERT INTO users(id,username,display_name,password_hash) SELECT md5('user'||i)::uuid,'load'||i,'负载成员'||i,(SELECT password_hash FROM users WHERE username='root') FROM generate_series(1,100)i;
INSERT INTO groups(id,name) VALUES(md5('loadgroup')::uuid,'性能编辑组');
INSERT INTO group_members SELECT md5('loadgroup')::uuid,md5('user'||i)::uuid FROM generate_series(1,20)i;
INSERT INTO knowledge_bases(id,name,owner_id) SELECT md5('kb'||i)::uuid,'中文知识库'||i,md5('user'||i)::uuid FROM generate_series(1,100)i;
INSERT INTO knowledge_base_acl(id,knowledge_base_id,group_id,role) SELECT md5('acl'||i)::uuid,md5('kb'||i)::uuid,md5('loadgroup')::uuid,2 FROM generate_series(1,100)i;
INSERT INTO pages(id,knowledge_base_id,parent_id,title,created_by,current_revision_id,body_text,acl_mode) SELECT md5('page'||i)::uuid,md5('kb'||((i-1)/1000+1))::uuid,CASE WHEN (i-1)%8=0 THEN NULL ELSE md5('page'||(i-1))::uuid END,'中文研发部署指南 '||i,md5('user'||((i-1)/1000+1))::uuid,md5('rev'||i)::uuid,repeat('中文知识管理、权限与部署检查。',60)||i,CASE WHEN i%100=0 THEN 'independent' ELSE 'inherit' END FROM generate_series(1,100000)i;
INSERT INTO page_acl(id,page_id,group_id,role) SELECT md5('pa'||i)::uuid,md5('page'||i)::uuid,md5('loadgroup')::uuid,2 FROM generate_series(100,100000,100)i;
INSERT INTO page_revisions(id,page_id,revision_no,title,schema_version,body_json,editor_id) SELECT md5('rev'||i)::uuid,md5('page'||i)::uuid,1,'中文研发部署指南 '||i,1,jsonb_build_object('type','doc','content',jsonb_build_array(jsonb_build_object('type','paragraph','content',jsonb_build_array(jsonb_build_object('type','text','text',repeat('中文知识管理、权限与部署检查。',60)||i))))),md5('user'||((i-1)/1000+1))::uuid FROM generate_series(1,100000)i;
COMMIT; ANALYZE pages; ANALYZE page_revisions; ANALYZE page_acl; ANALYZE knowledge_base_acl; ANALYZE users;
"""
started=time.monotonic();sql(seed,url);seed_seconds=time.monotonic()-started
log=(root/'.data/benchmark.log').open('w');server=subprocess.Popen([str(root/'backend/target/debug/wiki-api')],env=env,stdout=log,stderr=log)
origin=env['APP_BASE_URL']
try:
 for _ in range(100):
  try:urllib.request.urlopen(origin+'/health/ready',timeout=1);break
  except OSError:time.sleep(.1)
 import hashlib
 ready=threading.Barrier(20)
 def client(i):
  opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()));csrf=''
  def call(path,method='GET',body=None):
   req=urllib.request.Request(origin+'/api/v1'+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Content-Type':'application/json','Origin':origin,'X-CSRF-Token':csrf});start=time.monotonic()
   with opener.open(req,timeout=180) as response:result=json.load(response)
   return result,(time.monotonic()-start)*1000
  actor,_=call('/auth/login','POST',{'username':'load'+str(i),'password':password});csrf=actor['csrf_token'];pid=str(uuid.UUID(hashlib.md5(('page'+str(i*100+1)).encode()).hexdigest()));samples={k:[] for k in ['read','save','search']}
  ready.wait(timeout=60)
  for n in range(int(os.environ.get("BENCH_ITERATIONS","3"))):
   page,ms=call('/pages/'+pid);samples['read'].append(ms)
   _,ms=call('/pages/'+pid+'/revisions','POST',{'request_id':str(uuid.uuid4()),'base_revision_id':page['current_revision_id'],'title':page['title'],'schema_version':1,'body':page['body']});samples['save'].append(ms)
   _,ms=call('/search?q='+urllib.parse.quote('部署'));samples['search'].append(ms)
  return samples
 r=[];errors=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
  for future in concurrent.futures.as_completed([executor.submit(client,i) for i in range(1,21)]):
   try:r.append(future.result())
   except Exception as e:errors.append(type(e).__name__+': '+str(e))
 summary={}
 for metric in ['read','save','search']:
  values=sorted(v for item in r for v in item[metric])
  if not values:summary[metric]={'count':0};continue
  summary[metric]={'count':len(values),'p50_ms':statistics.median(values),'p95_ms':values[int(len(values)*.95)-1],'max_ms':max(values)}
 report={'pages':100000,'registered_users':100,'concurrency':20,'depth':8,'independent_boundaries':1000,'body_characters':1020,'seed_seconds':seed_seconds,'environment':{'cpu_count':os.cpu_count(),'platform':platform.platform()},'metrics':summary,'errors':errors,'measurement':'all 20 sessions authenticated before timed read/save/search loops'}
 import re
 source=(root/'backend/src/search.rs').read_text();raw=re.search(r'query_as::<_,SearchHit>\("(.*?)"\)',source).group(1);statement=json.loads('"'+raw+'"')
 actor=str(uuid.UUID(hashlib.md5(b'user1').hexdigest()));parameters={1:"'"+actor+"'::uuid",2:"'%部署%'",3:'NULL::uuid',4:"'all'",5:'NULL::uuid',6:"'creator'",7:'NULL::uuid',8:'21'}
 for n in range(8,0,-1):statement=statement.replace('$'+str(n),parameters[n])
 plan=json.loads(sql('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+statement,url));(root/'docs/search-query-plan.json').write_text(json.dumps(plan,indent=2)+'\n')
 output=root/os.environ.get('BENCHMARK_REPORT','docs/benchmark-baseline.json');output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(summary,indent=2))
finally:
 server.terminate();server.wait(timeout=15);log.close();sql('DROP SCHEMA '+schema+' CASCADE')
