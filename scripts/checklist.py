import sys
from pathlib import Path
p=Path('docs/CHECKLIST.md')
s=p.read_text().splitlines()
for i,line in enumerate(s):
    if line.startswith('| '+sys.argv[1]+' '):
        cells=line.split('|');cells[2]=' ✔ ';cells[3]=' '+sys.argv[2]+' ';s[i]='|'.join(cells)
p.write_text('\n'.join(s)+'\n')
