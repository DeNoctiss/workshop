"""Normalize pinned MIT sources + hand-checked official facts. Writes a review candidate only.
Usage: python3 scripts/import-catalog.py output.json
Never contacts a server; explicit refresh lives in fetch-catalog-sources.py.
"""
import json,pathlib,hashlib,re,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]; S=ROOT/'catalog-sources';manifest=json.loads((S/'manifest.json').read_text());byfile={x['file']:x for x in manifest['sources']};out=[]
for entry in manifest['sources']:
 if hashlib.sha256((S/entry['file']).read_bytes()).hexdigest()!=entry['sha256']:raise ValueError('Source changed: '+entry['file'])
def base(id,cat,name,brand,series,sku,url,license):return dict(id=id,source='builtin',category=cat,name=name,brand=brand,series=series,sku=sku,aliases=[],packages=[],properties={'kind':cat},urls=[url],checkedAt='2026-10-28',datasetVersion='2026.10.28',license=license)
for filename,brand,series,limit in [('vallejo','Vallejo','Model Color',12),('ak','AK Interactive','3rd Gen',10),('army','The Army Painter','Warpaints',10),('citadel','Citadel','Base',10)]:
 path='paints-'+filename+'.md';chosen={}
 for line in (S/path).read_text().splitlines():
  if '![#' not in line:continue
  a=line.strip('|').split('|')
  if filename=='citadel':name,lineup=a[:2];sku=''
  else:name,sku,lineup=a[:3]
  if sku=='null':sku=''
  if series not in lineup or any(w in name.lower() for w in ['varnish','primer','medium','thinner']):continue
  id='mp-'+hashlib.sha256('|'.join([brand,lineup,name,sku]).encode()).hexdigest()[:16]
  if id in chosen:continue
  p=base(id,'paint',name,brand,lineup,sku,byfile[path]['url'],'MIT · Rick Fleuren (2022)');p['colorHex']=re.search(r'`(#[0-9a-fA-F]{6})`',line).group(1);chosen[id]=p
  if len(chosen)==limit:break
 out+=list(chosen.values())
for filename in ['bambulab','esun','polymaker','prusament','sunlu']:
 d=json.loads((S/(filename+'.json')).read_text());chosen={}
 for f in d['filaments']:
  if f['material'] not in ['PLA','PETG','ASA','TPU'] or 1.75 not in f.get('diameters',[]):continue
  for c in f['colors'][:2]:
   if not re.fullmatch('[a-fA-F0-9]{6}',c.get('hex','')):continue
   name=f['name'].replace('{color_name}',c['name']);name=f['material']+' '+name if f['material'] not in name else name
   id='sp-'+hashlib.sha256((filename+'|'+name+'|1.75').encode()).hexdigest()[:16]
   if id in chosen:continue
   p=base(id,'filament',name,d['manufacturer'],f['material'],'',byfile[filename+'.json']['url'],'MIT · Donkie (2024)');p.update(colorHex='#'+c['hex'].upper(),colorName=c['name']);props={'kind':'filament','polymer':f['material'],'diameter':1.75}
   if 'density' in f:props['density']=f['density']
   for key,target in [('extruder_temp_range','nozzle'),('bed_temp_range','bed')]:
    if key in f:props[target+'Min'],props[target+'Max']=f[key]
   p['properties']=props
   packs=[dict(id='g-'+str(w['weight']).replace('.','-'),label=str(w['weight'])+' г',qty=w['weight'],unit='g') for w in f.get('weights',[]) if w['weight']>0];p['packages']=list({x['id']:x for x in packs}.values());chosen[id]=p
  if len(chosen)>=6:break
 out+=list(chosen.values())[:6]
official_license='Фактические сведения производителя; изображения и описания не включены'
for color in ['Grey','Black','White']:
 p=base('official-elegoo-standard-v2-'+color.lower(),'resin','Standard V2.0 '+color,'ELEGOO','Standard V2.0','','https://www.elegoo.com/collections/resin/products/elegoo-standard-resin-v-2-0',official_license);p.update(colorName=color,properties={'kind':'resin','resinType':'standard','wavelength':405},packages=[dict(id='g-1000',label='1 кг',qty=1000,unit='g'),dict(id='g-2000',label='2 кг',qty=2000,unit='g')]);out.append(p)
for code,color in [('70.600','White'),('70.601','Grey'),('70.602','Black')]:
 p=base('official-vallejo-primer-'+code.replace('.','-'),'primer',color,'Vallejo','Surface Primer',code,'https://acrylicosvallejo.com/wp-content/uploads/2025/10/Catalogo_2026-R02.pdf',official_license);p['colorName']=color;out.append(p)
for code,finish in [('26.650','Глянцевый'),('26.651','Матовый'),('26.652','Сатиновый')]:
 p=base('official-vallejo-varnish-'+code.replace('.','-'),'varnish',finish+' Polyurethane Varnish','Vallejo','Polyurethane',code,'https://acrylicosvallejo.com/wp-content/uploads/2025/10/Catalogo_2026-R02.pdf',official_license);p.update(properties={'kind':'varnish','finish':finish,'application':'Кисть / аэрограф'},packages=[dict(id='ml-60',label='60 мл',qty=60,unit='ml')]);out.append(p)
ids=[p['id'] for p in out];assert len(ids)==len(set(ids));assert len(out)==81
patches=json.loads((S/'overrides.json').read_text()) if (S/'overrides.json').exists() else {}
for p in out:p.update(patches.get(p['id'],{}))
output=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'catalog-candidate.json'
if output.resolve()==(ROOT/'src/catalog/builtin.json').resolve():raise ValueError('Write a candidate and review the diff before replacing builtin.json')
output.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(len(out),'products written to',output)
