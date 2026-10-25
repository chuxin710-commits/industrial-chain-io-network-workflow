"""Import a Zotero RDF/PDF ZIP without modifying PDFs or trusting ZIP path names."""

import argparse
from contextlib import closing
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import struct
import sys
import time
import xml.etree.ElementTree as ET
import zipfile
import zlib

import pymupdf as fitz

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from library import LibraryStore

NS={'rdf':'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    'z':'http://www.zotero.org/namespaces/export#','dc':'http://purl.org/dc/elements/1.1/',
    'dcterms':'http://purl.org/dc/terms/','bib':'http://purl.org/net/biblio#',
    'foaf':'http://xmlns.com/foaf/0.1/','link':'http://purl.org/rss/1.0/modules/link/'}
ABOUT='{'+NS['rdf']+'}about'; RESOURCE='{'+NS['rdf']+'}resource'


def zip_name(info):
    try:
        raw=info.filename.encode('utf-8' if info.flag_bits&0x800 else 'cp437')
    except UnicodeEncodeError:
        raw=info.filename.encode('gbk')
    extra=info.extra
    while len(extra)>=4:
        key,size=struct.unpack('<HH',extra[:4]); value,extra=extra[4:4+size],extra[4+size:]
        if key==0x7075 and len(value)>5 and value[0]==1 and struct.unpack('<I',value[1:5])[0]==zlib.crc32(raw):
            return value[5:].decode('utf-8')
    return info.filename if info.flag_bits&0x800 else raw.decode('gbk')


class Plain(HTMLParser):
    def __init__(self): super().__init__(); self.parts=[]
    def handle_data(self,data): self.parts.append(data)


def plain(value):
    parser=Plain(); parser.feed(value or ''); return ' '.join(' '.join(parser.parts).split())


def text(node,path):
    return (node.findtext(path,default='',namespaces=NS) or '').strip()


def import_zip(archive_path,root):
    store=LibraryStore(root); (root/'pdfs').mkdir(exist_ok=True); (root/'covers').mkdir(exist_ok=True)
    report={'archive_sha256':hashlib.sha256(archive_path.read_bytes()).hexdigest(),'documents':0,'pdfs':0,'pages':0,'native_highlights':0,'rdf_notes':0,'missing_pdfs':0,'warnings':[]}
    with zipfile.ZipFile(archive_path) as archive:
        members={}
        for info in archive.infolist():
            name=zip_name(info).replace('\\','/')
            p=PurePosixPath(name)
            if p.is_absolute() or '..' in p.parts: raise ValueError('Unsafe archive path')
            if not info.is_dir():
                if name in members: raise ValueError('Duplicate archive path')
                members[name]=info
        pdfs={}
        for name,info in members.items():
            if not name.lower().endswith('.pdf'): continue
            data=archive.read(info); sha=hashlib.sha256(data).hexdigest()
            destination=root/'pdfs'/f'{sha}.pdf'
            if not destination.exists(): destination.write_bytes(data)
            native=[]
            fitz.TOOLS.mupdf_warnings(reset=True)
            with fitz.open(stream=data,filetype='pdf') as document:
                if document.needs_pass and not document.authenticate(''):
                    raise ValueError(f'PDF requires a password: {name}')
                cover=document[0].get_pixmap(matrix=fitz.Matrix(.35,.35),alpha=False)
                cover.save(str(root/'covers'/f'{sha}.jpg'))
                for pi,page in enumerate(document):
                    for annotation in page.annots() or []:
                        if annotation.type[0]!=8: continue
                        native.append({'page':pi+1,'native_id':annotation.info.get('id') or str(annotation.xref),
                                       'rect':list(annotation.rect),'quads':annotation.vertices,
                                       'rotation':page.rotation,'cropbox':list(page.cropbox),
                                       'body':annotation.info.get('content') or '',
                                       'author':annotation.info.get('title') or None})
                pdfs[name]={'pdf':sha,'pages':document.page_count,'native':native,'bytes':len(data)}
            warning=fitz.TOOLS.mupdf_warnings(reset=True)
            if warning: report['warnings'].append({'file':name,'parser_warning':warning[:1000]})
            report['pdfs']+=1;report['pages']+=pdfs[name]['pages'];report['native_highlights']+=len(native)
        papers=[];used=set()
        for rdf_name,info in members.items():
            if not rdf_name.lower().endswith('.rdf'): continue
            tree=ET.fromstring(archive.read(info)); index={n.get(ABOUT):n for n in tree if n.get(ABOUT)}
            base=PurePosixPath(rdf_name).parent
            for node in tree:
                item_type=text(node,'z:itemType')
                if not item_type or item_type=='attachment': continue
                identifier=hashlib.sha256((rdf_name+'\0'+node.get(ABOUT,'')).encode()).hexdigest()[:32]
                authors=[]
                for person in node.findall('bib:authors/rdf:Seq/rdf:li/foaf:Person',NS):
                    authors.append(' '.join(s for s in (text(person,'foaf:givenName'),text(person,'foaf:surname')) if s))
                date=text(node,'dc:date'); year=re.search(r'(?<!\d)(1[5-9]\d{2}|20\d{2})(?!\d)',date)
                tags=[plain(''.join(tag.itertext())) for tag in node.findall('dc:subject',NS)]
                journal=''
                for part in node.findall('dcterms:isPartOf',NS):
                    target=index.get(part.get(RESOURCE)) if part.get(RESOURCE) else part.find('bib:Journal',NS)
                    if target is not None: journal=text(target,'dc:title') or journal
                attachment=None
                for link in node.findall('link:link',NS):
                    target=index.get(link.get(RESOURCE))
                    if target is None:continue
                    path=target.find('z:path',NS)
                    if path is None:continue
                    name=(base/PurePosixPath(path.get(RESOURCE,''))).as_posix()
                    if name in pdfs: attachment=name;used.add(name);break
                notes=[]
                for link in node.findall('dcterms:isReferencedBy',NS):
                    target=index.get(link.get(RESOURCE))
                    if target is not None and target.tag=='{'+NS['bib']+'}Memo':
                        value=plain(text(target,'rdf:value'))
                        if value:notes.append(value)
                metadata={'title':plain(text(node,'dc:title')) or '未提供题名','authors':authors,
                          'year':int(year[0]) if year else None,'date':date,'journal':journal,
                          'abstract':plain(text(node,'dcterms:abstract')),'tags':tags,
                          'collection':PurePosixPath(rdf_name).parts[0],'item_type':item_type,
                          'source_rdf':rdf_name,'source_id':node.get(ABOUT),'source_pdf':attachment,
                          'pdf':pdfs[attachment]['pdf'] if attachment else None,
                          'pages':pdfs[attachment]['pages'] if attachment else 0,
                          'metadata_status':'zotero_rdf','archive_sha256':report['archive_sha256']}
                papers.append((identifier,metadata,pdfs[attachment]['native'] if attachment else [],notes))
        for name,pdf in pdfs.items():
            if name in used:continue
            papers.append((pdf['pdf'][:32],{'title':PurePosixPath(name).stem,'authors':[],'year':None,
                'journal':'','abstract':'','tags':[],'collection':PurePosixPath(name).parts[0],
                'item_type':'attachment','source_pdf':name,'pdf':pdf['pdf'],'pages':pdf['pages'],
                'metadata_status':'attachment_without_parent','archive_sha256':report['archive_sha256']},pdf['native'],[]))
        with closing(store.connect()) as db, db:
            for identifier,metadata,native,notes in papers:
                db.execute('INSERT INTO documents VALUES(?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata',
                           (identifier,json.dumps(metadata,ensure_ascii=False)))
                for i,mark in enumerate(native):
                    aid=hashlib.sha256((identifier+':pdf:'+str(mark['page'])+':'+mark['native_id']).encode()).hexdigest()[:32]
                    now=time.time()
                    changed=db.execute('''INSERT OR IGNORE INTO annotations(id,document_id,kind,page,color,body,quote,anchor,origin,created,updated)
                        VALUES(?,?,?,?,?,?,?,?,?,?,?)''',(aid,identifier,'source_highlight',mark['page'],'#f6d568',mark['body'],'',json.dumps(mark), 'pdf',now,now)).rowcount
                    if changed:db.execute('INSERT INTO events(document_id,annotation_id,operation,snapshot,created) VALUES(?,?,?,?,?)',(identifier,aid,'import','{}',now))
                for i,note in enumerate(notes):
                    aid=hashlib.sha256((identifier+':rdf:'+str(i)).encode()).hexdigest()[:32];now=time.time()
                    changed=db.execute('''INSERT OR IGNORE INTO annotations(id,document_id,kind,color,body,quote,anchor,origin,created,updated)
                        VALUES(?,?,?,?,?,?,?,?,?,?)''',(aid,identifier,'note','#f6d568',note,'','{}','rdf',now,now)).rowcount
                    if changed:db.execute('INSERT INTO events(document_id,annotation_id,operation,snapshot,created) VALUES(?,?,?,?,?)',(identifier,aid,'import','{}',now))
                report['rdf_notes']+=len(notes)
            report['documents']=len(papers);report['missing_pdfs']=sum(not metadata['pdf'] for _,metadata,_,_ in papers)
    (root/'import-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--archive',required=True,type=Path)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]/'var/library')
    args=parser.parse_args();report=import_zip(args.archive,args.root)
    print(json.dumps({key:value for key,value in report.items() if key!='warnings'},ensure_ascii=False,indent=2))
