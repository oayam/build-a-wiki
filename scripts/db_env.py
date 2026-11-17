"""Translate a PostgreSQL URL into libpq environment fields without command-line secrets."""
import os,urllib.parse

def database_env(url):
 p=urllib.parse.urlsplit(url)
 if p.scheme not in ('postgres','postgresql') or not p.hostname or not p.path.strip('/'):
  raise ValueError('explicit PostgreSQL database URL required')
 env={**os.environ,'PGHOST':p.hostname,'PGPORT':str(p.port or 5432),'PGUSER':urllib.parse.unquote(p.username or ''),'PGPASSWORD':urllib.parse.unquote(p.password or ''),'PGDATABASE':urllib.parse.unquote(p.path.lstrip('/'))}
 for key,value in urllib.parse.parse_qsl(p.query):
  if key=='options':env['PGOPTIONS']=value
  elif key=='sslmode':env['PGSSLMODE']=value
 return env
