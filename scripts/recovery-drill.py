"""Isolated new-database restore drill. Requires local postgres superuser via runuser."""
from db_env import database_env
import hashlib,json,os,pathlib,shutil,subprocess,tempfile,time,urllib.parse,uuid
root=pathlib.Path(__file__).resolve().parent.parent;base=os.environ['TEST_DATABASE_URL'];prefix='drill_'+uuid.uuid4().hex[:12];source=prefix+'_source';target=prefix+'_restore';workspace=pathlib.Path(tempfile.mkdtemp(prefix='wiki-recovery-'));parts=urllib.parse.urlsplit(base)
def admin(sql):subprocess.run(['runuser','-u','postgres','--','psql','-X','-v','ON_ERROR_STOP=1','-c',sql],check=True,stdout=subprocess.DEVNULL)
def url(db):return urllib.parse.urlunsplit(parts._replace(path='/'+db,query=''))
def query(db,sql):return subprocess.check_output(['psql','-AtX','-v','ON_ERROR_STOP=1','-c',sql],env=database_env(url(db)),text=True).strip()
for name in [source,target]:admin('CREATE DATABASE '+name+' OWNER wiki')
try:
 env={**os.environ,'DATABASE_URL':url(source),'ATTACHMENT_DIR':str(workspace/'source-files')};pathlib.Path(env['ATTACHMENT_DIR']).mkdir();subprocess.run([str(root/'backend/target/debug/migrate')],env=env,check=True);password=uuid.uuid4().hex;subprocess.run([str(root/'backend/target/debug/bootstrap'),'drill-admin'],input=password,text=True,env=env,check=True)
 ids={k:str(uuid.uuid4()) for k in ['kb','page','revision','attachment','request']};data='备份恢复一致性附件'.encode();(pathlib.Path(env['ATTACHMENT_DIR'])/ids['attachment']).write_bytes(data)
 query(source,f"""BEGIN; INSERT INTO knowledge_bases(id,name,owner_id) SELECT '{ids['kb']}','恢复验证',id FROM users;
 INSERT INTO pages(id,knowledge_base_id,title,created_by,current_revision_id) SELECT '{ids['page']}','{ids['kb']}','恢复页面',id,'{ids['revision']}' FROM users;
 INSERT INTO page_revisions(id,page_id,revision_no,title,schema_version,body_json,editor_id) SELECT '{ids['revision']}','{ids['page']}',1,'恢复页面',1,'{{"type":"doc","content":[{{"type":"paragraph"}}]}}',id FROM users;
 INSERT INTO attachments(id,page_id,uploader_id,upload_id,storage_key,original_name,mime_type,size,checksum,status) SELECT '{ids['attachment']}','{ids['page']}',id,'{ids['request']}','{ids['attachment']}','资料.txt','application/octet-stream',{len(data)},'{hashlib.sha256(data).hexdigest()}','ready' FROM users; COMMIT;""")
 start=time.monotonic();subprocess.run(['python3',str(root/'scripts/backup.py'),str(workspace/'backup')],env=env,check=True);backup_seconds=time.monotonic()-start
 target_env={**env,'DATABASE_URL':url(target),'ATTACHMENT_DIR':str(workspace/'restored-files')};start=time.monotonic();subprocess.run(['python3',str(root/'scripts/restore.py'),str(workspace/'backup')],env=target_env,check=True);restore_seconds=time.monotonic()-start
 assert query(target,"SELECT maintenance FROM auth_guard")=='t';assert query(source,"SELECT maintenance FROM auth_guard")=='f'
 assert query(source,"SELECT row_to_json(p)::text FROM pages p")==query(target,"SELECT row_to_json(p)::text FROM pages p")
 assert query(target,"SELECT page_role((SELECT id FROM users),(SELECT id FROM pages))")=='3';assert query(target,"SELECT count(*) FROM page_revisions")=='1'
 assert (pathlib.Path(target_env['ATTACHMENT_DIR'])/ids['attachment']).read_bytes()==data
 # A second restore must reject non-empty destinations; corrupted backups must fail verification.
 assert subprocess.run(['python3',str(root/'scripts/restore.py'),str(workspace/'backup')],env=target_env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0
 (workspace/'backup'/'attachments'/ids['attachment']).write_bytes(b'tampered')
 assert subprocess.run(['python3',str(root/'scripts/restore.py'),str(workspace/'backup')],env=target_env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0
 result={'backup_seconds':backup_seconds,'restore_seconds':restore_seconds,'observed_rpo_seconds':0,'scope':'quiesced one-page fixture, one attachment; not a full-capacity RTO guarantee','verified':['page','revision','owner permission','attachment checksum','maintenance retained','nonempty restore rejected','corrupt backup rejected']};(root/'docs/recovery-drill.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,indent=2))
finally:
 for name in [source,target]:admin('DROP DATABASE '+name+' WITH (FORCE)')
 shutil.rmtree(workspace)
