from db_env import database_env
"""Restore into an empty database and empty attachment directory only."""
import argparse,hashlib,json,os,pathlib,shutil,subprocess
p=argparse.ArgumentParser();p.add_argument('backup');args=p.parse_args();source=pathlib.Path(args.backup).resolve();dest=pathlib.Path(os.environ['ATTACHMENT_DIR']).resolve();env=database_env(os.environ['DATABASE_URL'])
manifest=json.loads((source/'manifest.json').read_text());assert manifest['format']==1
actual={str(f.relative_to(source)) for f in source.rglob('*') if f.is_file() and f.name!='manifest.json'}
if actual!=set(manifest['files']):raise SystemExit('backup file inventory mismatch')
for name,expected in manifest['files'].items():
 f=source/name
 if not f.resolve().is_relative_to(source) or f.is_symlink():raise SystemExit('unsafe backup path')
 with f.open('rb') as stream:
  digest=hashlib.sha256()
  for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
 if digest.hexdigest()!=expected:raise SystemExit('backup checksum mismatch')
count=subprocess.check_output(['psql','-AtX','-v','ON_ERROR_STOP=1','-c',"SELECT count(*) FROM pg_tables WHERE schemaname NOT IN('pg_catalog','information_schema')"],env=env,text=True).strip()
if count!='0':raise SystemExit('restore requires an empty database; existing data will not be overwritten')
if dest.exists() and any(dest.iterdir()):raise SystemExit('restore requires an empty attachment directory')
dest.mkdir(mode=0o700,parents=True,exist_ok=True)
# Keep the restored database in maintenance until operator verification.
subprocess.run(['pg_restore','--exit-on-error','--single-transaction','--no-owner','--no-privileges','--dbname',env['PGDATABASE'],str(source/'database.dump')],env=env,check=True)
shutil.copytree(source/'attachments',dest,dirs_exist_ok=True)
print('Restore complete; maintenance remains ON. Verify contents before maintenance off.')
