"""Verify the isolated HTTPS candidate, with no external container network access."""
import json,os,pathlib,ssl,subprocess,time,urllib.request,uuid
root=pathlib.Path(__file__).resolve().parent.parent
config=os.environ.get('DEPLOY_ENV',str(root/'.data/compose-test.env'));project=os.environ.get('COMPOSE_PROJECT_NAME','wiki-acceptance');origin=os.environ.get('E2E_BASE_URL','https://127.0.0.1:18443');compose=['docker','compose','--env-file',config,'-p',project,'-f',str(root/'deploy/compose.yaml')]
subprocess.run(compose+['up','-d','--no-build','--pull','never'],check=True)
context=ssl.create_default_context(cafile=str(root/'.data/tls-test/fullchain.pem'));opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=context))
for _ in range(120):
 try:
  with opener.open(origin+'/health/ready',timeout=2) as r:
   assert r.status==200;break
 except OSError:time.sleep(.5)
else:raise RuntimeError('HTTPS candidate not ready')
password_file=root/'.data'/f'{project}-password'
count=subprocess.check_output(compose+['exec','-T','postgres','psql','-U','wiki','-d','wiki','-Atc','SELECT count(*) FROM users'],text=True).strip()
if count=='0':
 password=uuid.uuid4().hex;password_file.write_text(password+'\n');password_file.chmod(0o600);subprocess.run(compose+['exec','-T','api','bootstrap','root'],input=password,text=True,check=True)
else:password=password_file.read_text().strip()
for suffix in ['internal']:
 internal=subprocess.check_output(['docker','network','inspect',project+'_'+suffix,'--format','{{.Internal}}'],text=True).strip();assert internal=='true'
gateway_id=subprocess.check_output(compose+['ps','-q','gateway'],text=True).strip()
info=json.loads(subprocess.check_output(['docker','inspect',gateway_id],text=True))[0];edge_ip=info['NetworkSettings']['Networks'][project+'_edge']['IPAddress']
rule=['-s',edge_ip+'/32','-m','conntrack','--ctstate','NEW','-j','REJECT']
subprocess.run(['iptables','-I','DOCKER-USER','1',*rule],check=True)
# Dedicated deployment tests also verify Secure/HttpOnly/SameSite, Origin and CSP.
start=time.monotonic()
try:
 subprocess.run(compose+['exec','-T','gateway','sh','-c',"command -v wget >/dev/null && ! wget -T 2 -qO- http://1.1.1.1 >/dev/null 2>&1"],check=True)
 subprocess.run(['npx','playwright','test','content.spec.ts','pages.spec.ts','deployment.spec.ts'],cwd=root/'frontend',env={**os.environ,'E2E_BASE_URL':origin,'E2E_TEST_TLS':'1','E2E_DEPLOYMENT':'1','E2E_PASSWORD':password},check=True)
finally:
 subprocess.run(['iptables','-D','DOCKER-USER',*rule],check=True)
images=json.loads(subprocess.check_output(['docker','image','inspect','build-a-wiki-api:0.1.0-rc1','build-a-wiki-gateway:0.1.0-rc1','postgres:14.24-bookworm'],text=True))
report={'seconds':time.monotonic()-start,'tls':'SAN verified via test CA for readiness; browser test explicitly trusts test certificate','network':'API/database network internal; gateway outbound NEW connections blocked during browser acceptance; pulls forbidden','tests':['attachment/image/search/trash/audit','draft/conflict/history/move/recent','Secure cookie/CSRF Origin/CSP'],'images':[{'tags':i['RepoTags'],'id':i['Id']} for i in images]};(root/'docs/container-validation.json').write_text(json.dumps(report,indent=2)+'\n');print('HTTPS container acceptance passed')
