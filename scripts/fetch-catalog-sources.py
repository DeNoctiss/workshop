"""Developer-only explicit refresh of pinned source files. Not used by browser runtime."""
import pathlib,urllib.request,concurrent.futures,json,hashlib
root=pathlib.Path(__file__).resolve().parents[1]; dest=root/'catalog-sources';dest.mkdir(exist_ok=True)
paintrev='22791a682e1d155da388f4f856cd7196cd9f2677';filrev='9d53d28703ba1bcc97ab504e069d437ae2053c5a'
items=[('paints-'+n+'.md','Arcturus5404/miniature-paints',paintrev,'paints/'+p+'.md') for n,p in [('vallejo','Vallejo'),('ak','AK'),('army','Army_Painter'),('citadel','Citadel_Colour')]]+[(n+'.json','Donkie/SpoolmanDB',filrev,'filaments/'+n+'.json') for n in ['bambulab','esun','polymaker','prusament','sunlu']]+[('paints-license.txt','Arcturus5404/miniature-paints',paintrev,'LICENSE'),('filament-license.txt','Donkie/SpoolmanDB',filrev,'LICENSE')]
def fetch(item):
 name,repo,rev,path=item;url=f'https://raw.githubusercontent.com/{repo}/{rev}/{path}';data=urllib.request.urlopen(url,timeout=45).read();(dest/name).write_bytes(data);return {'file':name,'url':f'https://github.com/{repo}/blob/{rev}/{path}','revision':rev,'sha256':hashlib.sha256(data).hexdigest(),'license':'MIT'}
records=list(concurrent.futures.ThreadPoolExecutor(max_workers=5).map(fetch,items));(dest/'manifest.json').write_text(json.dumps({'version':'2026.10.28','retrievedAt':'2026-10-28','sources':records},indent=2)+'\n');print('Downloaded',len(records),'pinned snapshots')
