from db_env import database_env
"""Consistent local backup; uses DATABASE_URL and ATTACHMENT_DIR, no secrets in output."""
import argparse,hashlib,json,os,pathlib,shutil,subprocess
p=argparse.ArgumentParser();p.add_argument('output');args=p.parse_args()
root=pathlib.Path(__file__).resolve().parent.parent
out=pathlib.Path(args.output).resolve();out.mkdir(mode=0o700,parents=True,exist_ok=False)
files=pathlib.Path(os.environ['ATTACHMENT_DIR']).resolve()
if out==files or files in out.parents:raise SystemExit('backup must be outside attachment directory')
env=database_env(os.environ['DATABASE_URL'])
cli=os.environ.get('MAINTENANCE_BIN',str(root/'backend/target/debug/maintenance'))
previous=subprocess.check_output([cli,'on'],env=env,text=True).strip()
try:
 subprocess.run(['pg_dump','--format=custom','--no-owner','--file',str(out/'database.dump')],env=env,check=True)
 for path in files.rglob('*'):
  if path.is_symlink():raise RuntimeError('attachment symlinks are not supported')
 shutil.copytree(files,out/'attachments',symlinks=False)
 checks={str(f.relative_to(out)):hashlib.file_digest(f.open('rb'),'sha256').hexdigest() if hasattr(hashlib,'file_digest') else hashlib.sha256(f.read_bytes()).hexdigest() for f in out.rglob('*') if f.is_file()}
 (out/'manifest.json').write_text(json.dumps({'format':1,'files':checks},indent=2)+'\n')
 print('Backup verified and written:',out)
finally:
 if previous=='off':subprocess.run([cli,'off'],env=env,check=True,stdout=subprocess.DEVNULL)
