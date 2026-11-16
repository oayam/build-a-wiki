import json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parent.parent
npm=[]
for p in (root/'frontend/node_modules').glob('**/package.json'):
    if '/node_modules/' not in str(p): continue
    try:
        d=json.loads(p.read_text())
        if d.get('name') and d.get('version'): npm.append({k:d.get(k) for k in ('name','version','license','engines','peerDependencies')})
    except (ValueError,UnicodeError): pass
cargo=json.loads(subprocess.check_output(['cargo','metadata','--format-version','1','--locked','--manifest-path',str(root/'backend/Cargo.toml')]))
rust=[{k:p.get(k) for k in ('name','version','license','rust_version')} for p in cargo['packages']]
(root/'docs/licenses.json').write_text(json.dumps({'npm':sorted(npm,key=lambda x:(x['name'],x['version'])),'cargo':rust},ensure_ascii=False,indent=2)+'\n')
