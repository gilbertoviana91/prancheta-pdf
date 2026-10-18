// =====================================================================
// page modules: organize, merge, split, compress, convert
// =====================================================================

// lazy thumbnail rendering for cards
const thumbObserver = new IntersectionObserver(entries=>{
  for(const en of entries){ if(en.isIntersecting){ thumbObserver.unobserve(en.target); const fn=en.target._render; if(fn) fn(); } }
},{rootMargin:'400px'});
function lazyThumb(holder, getPage, maxW, maxH, rot){
  holder._render=async()=>{
    try{ const p=await getPage(); const c=await renderThumb(p,maxW,maxH,rot||0); holder.innerHTML=''; holder.appendChild(c); }
    catch(e){ console.warn(e); holder.innerHTML='<div class="blank">?</div>'; }
  };
  thumbObserver.observe(holder);
}
const ICON={
  rotL:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  rotR:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  del:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  up:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  down:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  grip:'<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  cut:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/></svg>'
};
// generic "open" wiring for a module
function wirePick(key, opts, handler){
  $$(`[data-pick="${key}"]`).forEach(b=>b.addEventListener('click',async()=>{ const fs=await pick(opts); if(fs.length) handler(fs); }));
}
async function openPdfFile(file){
  const bytes=await readBytes(file); const pdf=await loadPdfJs(bytes);
  return {name:file.name, bytes, pdf, pages:pdf.numPages};
}
function pageSizeOf(p){ const vp=p.getViewport({scale:1, rotation:0}); return [p.view[2]-p.view[0], p.view[3]-p.view[1]]; }

// =====================================================================
// ORGANIZAR
// =====================================================================
(function(){
  const grid=$('#orgGrid'); let srcs=[], pages=[], sel=new Set(), lastClick=null, nid=1, name='';
  async function load(files){
    const f=files.find(isPdfFile); if(!f){ toast('Escolha um PDF.',true); return; }
    if(pages.length && !confirm('Descartar as alterações deste PDF e abrir outro?')) return;
    busy(true,'Abrindo PDF…');
    try{
      const s=await openPdfFile(f); srcs=[s]; name=f.name; sel.clear();
      pages=[]; for(let i=0;i<s.pages;i++) pages.push({id:nid++, src:0, idx:i, rot:0});
      render();
    }catch(err){ toast('Não consegui abrir: '+friendlyError(err),true); }
    finally{ busy(false); }
  }
  async function addPdf(){
    const fs=await pick({accept:'.pdf,application/pdf',multiple:true}); if(!fs.length) return;
    busy(true,'Adicionando páginas…');
    try{
      let at=insertPos(); const add=[];
      for(const f of fs.filter(isPdfFile)){ const s=await openPdfFile(f); srcs.push(s); for(let i=0;i<s.pages;i++) add.push({id:nid++, src:srcs.length-1, idx:i, rot:0}); }
      pages.splice(at,0,...add); sel=new Set(add.map(p=>p.id)); render();
      toast(add.length+' página(s) adicionada(s).');
    }catch(err){ toast('Não consegui adicionar: '+friendlyError(err),true); }
    finally{ busy(false); }
  }
  function insertPos(){ if(!sel.size) return pages.length; let last=-1; pages.forEach((p,i)=>{ if(sel.has(p.id)) last=i; }); return last+1; }
  function render(){
    $('#orgEmpty').hidden=pages.length>0; $('#orgActions').hidden=!pages.length; $('#orgOpenOther').hidden=!pages.length;
    $('#orgSave').disabled=!pages.length; $('#orgExtract').disabled=!sel.size;
    $('#orgInfo').textContent=pages.length?`${name} · ${pages.length} página(s)${srcs.length>1?' · '+srcs.length+' arquivos':''}`:'Abra um PDF para ver as páginas.';
    $('#orgSelInfo').textContent=sel.size?`${sel.size} selecionada(s). As ações acima valem para elas.`:'Clique numa página para selecionar; Ctrl/Shift para várias. As ações acima valem para as selecionadas.';
    grid.innerHTML='';
    pages.forEach((p,i)=>{
      const c=document.createElement('div'); c.className='card'+(sel.has(p.id)?' sel':''); c.draggable=true; c.dataset.id=p.id;
      const th=document.createElement('div'); th.className='thumb';
      if(p.blank) th.innerHTML='<div class="blank">em branco</div>';
      else lazyThumb(th, ()=>srcs[p.src].pdf.getPage(p.idx+1), 130, 150, p.rot);
      if(p.blank && p.rot%180) th.firstChild.style.transform='rotate(90deg)';
      c.appendChild(th);
      const lab=document.createElement('div'); lab.className='lab';
      lab.textContent=`${i+1}`+(srcs.length>1&&!p.blank?` · ${baseName(srcs[p.src].name)} p.${p.idx+1}`:'')+(p.rot?` · ${p.rot}°`:'');
      c.appendChild(lab);
      const acts=document.createElement('div'); acts.className='acts';
      acts.innerHTML=`<button data-a="l" title="Girar à esquerda">${ICON.rotL}</button><button data-a="r" title="Girar à direita">${ICON.rotR}</button><button data-a="d" title="Excluir">${ICON.del}</button>`;
      c.appendChild(acts);
      c.addEventListener('click',ev=>{
        const a=ev.target.closest('button'); if(a){ ev.stopPropagation();
          if(a.dataset.a==='l') rotate([p.id],-90); else if(a.dataset.a==='r') rotate([p.id],90); else remove([p.id]); return; }
        if(ev.shiftKey && lastClick!==null){ const a1=pages.findIndex(x=>x.id===lastClick), b1=i; for(let k=Math.min(a1,b1);k<=Math.max(a1,b1);k++) sel.add(pages[k].id); }
        else if(ev.ctrlKey||ev.metaKey){ sel.has(p.id)?sel.delete(p.id):sel.add(p.id); }
        else { const only=sel.size===1&&sel.has(p.id); sel.clear(); if(!only) sel.add(p.id); }
        lastClick=p.id; render();
      });
      grid.appendChild(c);
    });
  }
  function targets(){ if(!sel.size){ toast('Selecione uma ou mais páginas primeiro.'); return null; } return [...sel]; }
  function rotate(ids,d){ pages.forEach(p=>{ if(ids.includes(p.id)) p.rot=((p.rot+d)%360+360)%360; }); render(); }
  function remove(ids){ if(pages.length-ids.length<1){ toast('O PDF precisa ter pelo menos uma página.',true); return; }
    pages=pages.filter(p=>!ids.includes(p.id)); ids.forEach(id=>sel.delete(id)); render(); }
  makeSortable(grid,'.card',(from,to)=>{ moveItem(pages,from,to); render(); },true);
  $('#orgRotL').onclick=()=>{ const t=targets(); if(t) rotate(t,-90); };
  $('#orgRotR').onclick=()=>{ const t=targets(); if(t) rotate(t,90); };
  $('#orgDel').onclick=()=>{ const t=targets(); if(t) remove(t); };
  $('#orgDup').onclick=()=>{ const t=targets(); if(!t) return; const out=[];
    pages.forEach(p=>{ out.push(p); if(t.includes(p.id)) out.push({...p, id:nid++}); }); pages=out; render(); };
  $('#orgBlank').onclick=async()=>{
    const at=insertPos(); const ref=pages[Math.max(0,at-1)]; let size=[595.28,841.89];
    if(ref){ if(ref.blank) size=ref.blank; else { const pg=await srcs[ref.src].pdf.getPage(ref.idx+1); size=pageSizeOf(pg); if(pg.rotate%180) size=[size[1],size[0]]; } }
    const np={id:nid++, blank:size, rot:0}; pages.splice(at,0,np); sel=new Set([np.id]); render(); };
  $('#orgAddPdf').onclick=addPdf;
  $('#orgSelAll').onclick=()=>{ sel=new Set(pages.map(p=>p.id)); render(); };
  $('#orgSelNone').onclick=()=>{ sel.clear(); render(); };
  async function build(list){
    const out=await PDFDocument.create(); const cache={};
    for(const p of list){
      if(p.blank){ const pg=out.addPage(p.blank); if(p.rot) pg.setRotation(degrees(p.rot)); continue; }
      if(!cache[p.src]) cache[p.src]=await loadPdfLib(srcs[p.src].bytes);
      const [pg]=await out.copyPages(cache[p.src],[p.idx]);
      const r=(pg.getRotation().angle+p.rot)%360; pg.setRotation(degrees(r)); out.addPage(pg);
    }
    return out.save();
  }
  $('#orgSave').onclick=async()=>{ busy(true,'Gerando PDF…'); try{ const b=await build(pages); if(await download(b, baseName(name)+' - organizado.pdf')) toast('PDF salvo.'); }catch(err){ toast('Erro: '+friendlyError(err),true); } finally{ busy(false); } };
  $('#orgExtract').onclick=async()=>{ const list=pages.filter(p=>sel.has(p.id)); if(!list.length) return; busy(true,'Extraindo…');
    try{ const b=await build(list); if(await download(b, baseName(name)+' - extraido.pdf')) toast(list.length+' página(s) extraída(s).'); }catch(err){ toast('Erro: '+friendlyError(err),true); } finally{ busy(false); } };
  wirePick('org',{accept:'.pdf,application/pdf'},load);
  dropZone($('#orgWork'),files=>{ if(pages.length){ /* add to current */ const pdfs=files.filter(isPdfFile); if(!pdfs.length) return;
      (async()=>{ busy(true,'Adicionando páginas…'); try{ const at=insertPos(), add=[]; for(const f of pdfs){ const s=await openPdfFile(f); srcs.push(s); for(let i=0;i<s.pages;i++) add.push({id:nid++,src:srcs.length-1,idx:i,rot:0}); } pages.splice(at,0,...add); render(); } catch(err){ toast(friendlyError(err),true);} finally{ busy(false); } })();
    } else load(files); });
  views.organize={};
  window.__org={load,get pages(){return pages;},set sel(v){sel=new Set(v);},render};
})();

// =====================================================================
// JUNTAR
// =====================================================================
(function(){
  const list=$('#mergeList'); let files=[], nid=1;
  async function add(fs){
    const pdfs=fs.filter(isPdfFile); if(!pdfs.length){ toast('Escolha arquivos PDF.',true); return; }
    busy(true,'Lendo arquivos…');
    try{ for(const f of pdfs){ busySub(f.name); try{ const s=await openPdfFile(f); files.push({id:nid++, ...s, range:''}); }catch(err){ toast(f.name+': '+friendlyError(err),true); } } }
    finally{ busy(false); }
    render();
  }
  function render(){
    $('#mergeEmpty').hidden=files.length>0; $('#mergeMore').hidden=!files.length;
    $('#mergeGo').disabled=files.length<1; $('#mergeClear').disabled=!files.length;
    const total=files.reduce((s,f)=>s+f.pages,0);
    $('#mergeInfo').textContent=files.length?`${files.length} arquivo(s) · ${total} página(s) no total`:'Nenhum arquivo ainda.';
    list.innerHTML='';
    files.forEach((f,i)=>{
      const it=document.createElement('div'); it.className='item'; it.draggable=true;
      it.innerHTML=`<div class="grip">${ICON.grip}</div><div class="mini"></div>
        <div class="meta"><b title="${esc(f.name)}">${i+1}. ${esc(f.name)}</b><small>${f.pages} página(s) · ${fmtBytes(f.bytes.length)}</small>
          <input class="field-in" placeholder="Páginas: todas" value="${esc(f.range)}" title="Ex.: 1-3, 5, 8-"></div>
        <div class="ops"><button class="btn sm icon" data-a="u" title="Subir">${ICON.up}</button><button class="btn sm icon" data-a="d" title="Descer">${ICON.down}</button><button class="btn sm icon danger" data-a="x" title="Remover">${ICON.del}</button></div>`;
      lazyThumb(it.querySelector('.mini'),()=>f.pdf.getPage(1),60,70);
      const inp=it.querySelector('input'); inp.addEventListener('input',()=>{ f.range=inp.value; }); inp.addEventListener('mousedown',e=>e.stopPropagation());
      inp.addEventListener('focus',()=>it.draggable=false); inp.addEventListener('blur',()=>it.draggable=true);
      it.querySelector('.ops').addEventListener('click',ev=>{ const b=ev.target.closest('button'); if(!b) return;
        if(b.dataset.a==='u'&&i>0) moveItem(files,i,i-1); else if(b.dataset.a==='d'&&i<files.length-1) moveItem(files,i,i+1); else if(b.dataset.a==='x') files.splice(i,1); render(); });
      list.appendChild(it);
    });
  }
  makeSortable(list,'.item',(a,b)=>{ moveItem(files,a,b); render(); },false);
  $('#mergeClear').onclick=()=>{ files=[]; render(); };
  $('#mergeGo').onclick=async()=>{
    if(files.length<2 && !files.some(f=>f.range.trim())){ toast('Adicione pelo menos dois PDFs.',true); return; }
    let plan; try{ plan=files.map(f=>({f, idx:rangesFlat(f.range,f.pages)})); }catch(err){ toast(err.message,true); return; }
    busy(true,'Juntando PDFs…');
    try{
      const out=await PDFDocument.create();
      for(const {f,idx} of plan){ busySub(f.name); const d=await loadPdfLib(f.bytes); const ps=await out.copyPages(d,idx); ps.forEach(p=>out.addPage(p)); await tick(); }
      const b=await out.save();
      if(await download(b, baseName(files[0].name)+' - juntado.pdf')) toast(`PDF com ${out.getPageCount()} páginas salvo.`);
    }catch(err){ toast('Erro ao juntar: '+friendlyError(err),true); }
    finally{ busy(false); }
  };
  wirePick('merge',{accept:'.pdf,application/pdf',multiple:true},add);
  dropZone($('#mergeWork'),add);
  views.merge={};
  window.__merge={add,get files(){return files;}};
})();

// =====================================================================
// DIVIDIR
// =====================================================================
(function(){
  const grid=$('#splitGrid'); let file=null, cuts=new Set();
  const mode=()=>document.querySelector('input[name="splitMode"]:checked').value;
  async function load(fs){
    const f=fs.find(isPdfFile); if(!f){ toast('Escolha um PDF.',true); return; }
    busy(true,'Abrindo PDF…');
    try{ file=await openPdfFile(f); cuts=new Set(); $('#splitRanges').value=''; render(); }
    catch(err){ toast('Não consegui abrir: '+friendlyError(err),true); }
    finally{ busy(false); }
  }
  function groups(){
    const n=file.pages, m=mode();
    if(m==='single') return [...Array(n).keys()].map(i=>[i]);
    if(m==='every'){ const k=Math.max(1,parseInt($('#splitEvery').value)||1); const g=[]; for(let i=0;i<n;i+=k) g.push([...Array(Math.min(k,n-i)).keys()].map(j=>i+j)); return g; }
    if(m==='pick'){ const g=[]; let cur=[]; for(let i=0;i<n;i++){ cur.push(i); if(cuts.has(i)&&i<n-1){ g.push(cur); cur=[]; } } g.push(cur); return g; }
    const r=parseRanges($('#splitRanges').value,n); return r||[];
  }
  const label=g=>g.length===1?`${g[0]+1}`:`${g[0]+1}–${g[g.length-1]+1}`;
  function updatePreview(){
    $('#splitRangesRow').hidden=mode()!=='ranges'; $('#splitEveryRow').hidden=mode()!=='every';
    grid.classList.toggle('picking',mode()==='pick');
    if(!file){ $('#splitPreview').textContent='—'; return; }
    try{ const g=groups();
      if(!g.length){ $('#splitPreview').innerHTML='Digite os intervalos, ex.: <b>1-3, 4-10, 11-</b>'; $('#splitGo').disabled=true; return; }
      $('#splitPreview').innerHTML=`Serão gerados <b>${g.length}</b> arquivo(s)${g.length>1?' (em um .zip)':''}:<br>`+g.slice(0,12).map(x=>'pág. '+label(x)).join(' · ')+(g.length>12?' …':'');
      $('#splitGo').disabled=false;
    }catch(err){ $('#splitPreview').innerHTML=`<span style="color:var(--danger)">${esc(err.message)}</span>`; $('#splitGo').disabled=true; }
    $$('#splitGrid .card').forEach((c,i)=>{ const on=mode()==='pick'&&cuts.has(i); c.classList.toggle('sel',on); const b=c.querySelector('.badge'); if(b) b.hidden=!on; });
  }
  function render(){
    $('#splitEmpty').hidden=!!file; $('#splitOpenOther').hidden=!file;
    $('#splitInfo').textContent=file?`${file.name} · ${file.pages} página(s)`:'Abra um PDF.';
    grid.innerHTML='';
    if(file) for(let i=0;i<file.pages;i++){
      const c=document.createElement('div'); c.className='card'; c.style.cursor='pointer';
      c.innerHTML=`<div class="thumb"></div><div class="lab">${i+1}</div><span class="badge" hidden>✂ corte depois</span>`;
      lazyThumb(c.querySelector('.thumb'),()=>file.pdf.getPage(i+1),130,150);
      c.title='No modo "Clicar onde dividir", clique para cortar depois desta página';
      c.onclick=()=>{ if(mode()!=='pick'){ document.querySelector('input[name="splitMode"][value="pick"]').checked=true; }
        if(i===file.pages-1) return; cuts.has(i)?cuts.delete(i):cuts.add(i); updatePreview(); };
      grid.appendChild(c);
    }
    updatePreview();
  }
  $$('input[name="splitMode"]').forEach(r=>r.addEventListener('change',updatePreview));
  $('#splitRanges').addEventListener('input',updatePreview); $('#splitEvery').addEventListener('input',updatePreview);
  $('#splitGo').onclick=async()=>{
    let g; try{ g=groups(); }catch(err){ toast(err.message,true); return; }
    busy(true,'Dividindo…');
    try{
      const src=await loadPdfLib(file.bytes), outs=[], base=baseName(file.name);
      for(let k=0;k<g.length;k++){
        busySub(`arquivo ${k+1} de ${g.length}`);
        const d=await PDFDocument.create(); const ps=await d.copyPages(src,g[k]); ps.forEach(p=>d.addPage(p));
        outs.push({name:`${base} - pág ${label(g[k]).replace('–','-')}.pdf`, data:await d.save(), mime:'application/pdf'}); await tick();
      }
      if(await saveMany(outs, base+' - dividido.zip')) toast(outs.length+' arquivo(s) gerado(s).');
    }catch(err){ toast('Erro ao dividir: '+friendlyError(err),true); }
    finally{ busy(false); }
  };
  wirePick('split',{accept:'.pdf,application/pdf'},load);
  dropZone($('#splitWork'),load);
  views.split={};
  window.__split={load};
})();

// =====================================================================
// COMPRIMIR
// =====================================================================
const Compress=(function(){
  const LEVELS={ low:{maxPx:2200,q:0.82}, mid:{maxPx:1600,q:0.72}, high:{maxPx:1100,q:0.58}, raster:{dpi:110,q:0.62} };
  function unpredict(data, w, colors, bpc, predictor){
    if(!predictor || predictor<10) return data;
    const bpp=Math.max(1,(colors*bpc)>>3), rowLen=(w*colors*bpc+7)>>3, rows=Math.floor(data.length/(rowLen+1));
    const out=new Uint8Array(rows*rowLen); let prev=new Uint8Array(rowLen);
    for(let r=0;r<rows;r++){
      const ft=data[r*(rowLen+1)], row=data.subarray(r*(rowLen+1)+1,(r+1)*(rowLen+1)), cur=out.subarray(r*rowLen,(r+1)*rowLen);
      for(let i=0;i<rowLen;i++){
        const a=i>=bpp?cur[i-bpp]:0, b=prev[i], c=i>=bpp?prev[i-bpp]:0; let x=row[i];
        if(ft===1) x+=a; else if(ft===2) x+=b; else if(ft===3) x+=(a+b)>>1;
        else if(ft===4){ const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c); x+= (pa<=pb&&pa<=pc)?a:(pb<=pc)?b:c; }
        cur[i]=x&255;
      }
      prev=cur;
    }
    return out;
  }
  const DECODABLE=new Set(['ASCII85Decode','ASCIIHexDecode','FlateDecode','LZWDecode','RunLengthDecode']);
  function filterList(dict){
    const f=dict.lookup(PDFName.of('Filter'));
    if(f instanceof PDFName) return [f.decodeText()];
    if(f instanceof PDFArray) return f.asArray().map(x=>x instanceof PDFName?x.decodeText():'?');
    return [];
  }
  function parmsFor(dict, idx){
    const dp=dict.lookup(PDFName.of('DecodeParms'));
    if(dp instanceof PDFDict) return dp;
    if(dp instanceof PDFArray){ const x=dp.lookup(idx); return x instanceof PDFDict?x:null; }
    return null;
  }
  function colorComps(doc, cs){
    if(cs instanceof PDFName){ const n=cs.decodeText(); return n==='DeviceRGB'?3:n==='DeviceGray'?1:0; }
    if(cs instanceof PDFArray && cs.lookup(0)===PDFName.of('ICCBased')){ const s=cs.lookup(1); const n=s&&s.dict?s.dict.lookup(PDFName.of('N')):null; const v=n instanceof PDFNumber?n.asNumber():0; return v===3||v===1?v:0; }
    return 0;
  }
  async function recompressImages(doc, lv, onProgress){
    const ctx=doc.context; const smasks=new Set(); const imgs=[];
    for(const [ref,obj] of ctx.enumerateIndirectObjects()){
      if(!(obj instanceof PDFRawStream)) continue;
      const d=obj.dict; if(d.lookup(PDFName.of('Subtype'))!==PDFName.of('Image')) continue;
      const sm=d.get(PDFName.of('SMask')); if(sm instanceof PDFRef) smasks.add(sm.toString());
      imgs.push([ref,obj]);
    }
    let saved=0, done=0;
    for(const [ref,obj] of imgs){
      done++; if(onProgress) onProgress(done,imgs.length);
      if(smasks.has(ref.toString())) continue;
      const d=obj.dict;
      { const im=d.lookup(PDFName.of('ImageMask')); if(im && String(im)==='true') continue; }
      if(d.lookup(PDFName.of('Decode')) || d.lookup(PDFName.of('Mask')) instanceof PDFArray) continue;
      const w=(d.lookup(PDFName.of('Width'))||{}).asNumber?.(), h=(d.lookup(PDFName.of('Height'))||{}).asNumber?.();
      const bpcO=d.lookup(PDFName.of('BitsPerComponent')); const bpc=bpcO instanceof PDFNumber?bpcO.asNumber():8;
      if(!w||!h||w*h<4096) continue;
      const comps=colorComps(doc,d.lookup(PDFName.of('ColorSpace')));
      const filters=filterList(d), last=filters[filters.length-1];
      if(!filters.length || !filters.slice(0,-1).every(f=>DECODABLE.has(f))) continue;
      const decodeChain=list=>{ const tmp=PDFRawStream.of(ctx.obj({Filter:list}),obj.contents); return decodePDFRawStream(tmp).decode(); };
      let bitmap=null;
      try{
        if(last==='DCTDecode'){
          if(comps===0) continue; // CMYK / special color spaces: keep untouched
          const jpg = filters.length===1 ? obj.contents : decodeChain(filters.slice(0,-1));
          bitmap=await createImageBitmap(new Blob([jpg],{type:'image/jpeg'}));
        } else if(last==='FlateDecode' && filters.every(f=>DECODABLE.has(f)) && bpc===8 && comps){
          const dp=parmsFor(d, filters.length-1);
          const pred=dp && dp.lookup(PDFName.of('Predictor')) instanceof PDFNumber ? dp.lookup(PDFName.of('Predictor')).asNumber() : 1;
          if(pred===2) continue;
          let raw;
          try{ raw=decodeChain(filters); }catch(_){ continue; }
          raw=unpredict(raw,w,comps,8,pred);
          if(raw.length<w*h*comps) continue;
          const id=new ImageData(w,h); const px=id.data;
          for(let i=0,j=0;i<w*h;i++){ if(comps===3){ px[j++]=raw[i*3]; px[j++]=raw[i*3+1]; px[j++]=raw[i*3+2]; } else { const v=raw[i]; px[j++]=v; px[j++]=v; px[j++]=v; } px[j++]=255; }
          bitmap=await createImageBitmap(id);
        } else continue;
      }catch(e){ console.warn('skip image',e); continue; }
      const s=Math.min(1, lv.maxPx/Math.max(w,h));
      const nw=Math.max(1,Math.round(w*s)), nh=Math.max(1,Math.round(h*s));
      const c=document.createElement('canvas'); c.width=nw; c.height=nh;
      const g=c.getContext('2d'); g.imageSmoothingQuality='high'; g.fillStyle='#fff'; g.fillRect(0,0,nw,nh); g.drawImage(bitmap,0,0,nw,nh); bitmap.close&&bitmap.close();
      const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',lv.q)); c.width=c.height=0;
      const nb=new Uint8Array(await blob.arrayBuffer());
      if(nb.length >= obj.contents.length*0.92) continue;
      const nd=ctx.obj({});
      for(const [k,v] of d.entries()){ const kk=k.asString(); if(!['/Filter','/DecodeParms','/Length','/ColorSpace','/BitsPerComponent','/Width','/Height','/Decode'].includes(kk)) nd.set(k,v); }
      nd.set(PDFName.of('Filter'),PDFName.of('DCTDecode')); nd.set(PDFName.of('ColorSpace'),PDFName.of('DeviceRGB'));
      nd.set(PDFName.of('BitsPerComponent'),PDFNumber.of(8)); nd.set(PDFName.of('Width'),PDFNumber.of(nw)); nd.set(PDFName.of('Height'),PDFNumber.of(nh));
      ctx.assign(ref, PDFRawStream.of(nd, nb));
      saved+=obj.contents.length-nb.length;
      if(done%4===0) await tick();
    }
    return {count:imgs.length, saved};
  }
  async function rasterize(pdf, lv, onProgress){
    const out=await PDFDocument.create();
    for(let i=1;i<=pdf.numPages;i++){
      onProgress&&onProgress(i,pdf.numPages);
      const p=await pdf.getPage(i); const vp=p.getViewport({scale:1});
      const blob=await renderPageImage(p, lv.dpi, 'image/jpeg', lv.q);
      const img=await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const pg=out.addPage([vp.width,vp.height]); pg.drawImage(img,{x:0,y:0,width:vp.width,height:vp.height});
      await tick();
    }
    return out.save({useObjectStreams:true});
  }
  async function compress(bytes, pdf, level, onProgress){
    const lv=LEVELS[level];
    if(level==='raster') return rasterize(pdf,lv,onProgress);
    const doc=await loadPdfLib(bytes);
    await recompressImages(doc,lv,onProgress);
    return doc.save({useObjectStreams:true, updateFieldAppearances:false});
  }

  const grid=$('#compGrid'); let file=null;
  async function load(fs){
    const f=fs.find(isPdfFile); if(!f){ toast('Escolha um PDF.',true); return; }
    busy(true,'Abrindo PDF…');
    try{ file=await openPdfFile(f); render(); } catch(err){ toast('Não consegui abrir: '+friendlyError(err),true); } finally{ busy(false); }
  }
  function render(){
    $('#compEmpty').hidden=!!file; $('#compOpenOther').hidden=!file; $('#compGo').disabled=!file;
    $('#compInfo').textContent=file?`${file.name} · ${file.pages} página(s) · ${fmtBytes(file.bytes.length)}`:'Abra um PDF.';
    $('#compResult').textContent=file?'Escolha o nível e clique em comprimir.':'—';
    grid.innerHTML='';
    if(file) for(let i=0;i<Math.min(file.pages,60);i++){
      const c=document.createElement('div'); c.className='card'; c.style.cursor='default';
      c.innerHTML=`<div class="thumb"></div><div class="lab">${i+1}</div>`; lazyThumb(c.querySelector('.thumb'),()=>file.pdf.getPage(i+1),130,150); grid.appendChild(c);
    }
  }
  $('#compGo').onclick=async()=>{
    const level=document.querySelector('input[name="compLevel"]:checked').value;
    busy(true,'Comprimindo…');
    try{
      const out=await compress(file.bytes,file.pdf,level,(a,b)=>busySub(level==='raster'?`página ${a} de ${b}`:`imagem ${a} de ${b}`));
      const before=file.bytes.length, after=out.length, pct=Math.round((1-after/before)*100);
      if(after>=before*0.98){
        $('#compResult').innerHTML=`Não foi possível reduzir: este PDF já está otimizado (<b>${fmtBytes(before)}</b>).${level!=='raster'?' Tente o nível Forte ou Máxima.':''}`;
        toast('O PDF já está otimizado; nada foi salvo.'); return;
      }
      $('#compResult').innerHTML=`<b>${fmtBytes(before)}</b> → <b>${fmtBytes(after)}</b> (−${pct}%)`;
      if(await download(out, baseName(file.name)+' - comprimido.pdf')) toast(`PDF ${pct}% menor salvo.`);
    }catch(err){ console.error(err); toast('Erro ao comprimir: '+friendlyError(err),true); }
    finally{ busy(false); }
  };
  wirePick('comp',{accept:'.pdf,application/pdf'},load);
  dropZone($('#compWork'),load);
  views.compress={};
  window.__comp={load};
  return {compress};
})();

// =====================================================================
// CONVERTER
// =====================================================================
(function(){
  const grid=$('#convGrid'); let mode=null, file=null, imgs=[], nid=1;
  const to=()=>document.querySelector('input[name="convTo"]:checked').value;
  async function load(fs){
    const pdf=fs.find(isPdfFile), images=fs.filter(isImageFile);
    if(pdf){
      busy(true,'Abrindo PDF…');
      try{ file=await openPdfFile(pdf); mode='pdf'; imgs=[]; render(); } catch(err){ toast('Não consegui abrir: '+friendlyError(err),true); } finally{ busy(false); }
    } else if(images.length){
      if(mode!=='img'){ imgs=[]; file=null; }
      mode='img';
      for(const f of images) imgs.push({id:nid++, file:f, url:URL.createObjectURL(f)});
      render();
    } else toast('Escolha um PDF ou imagens (JPG, PNG…).',true);
  }
  function render(){
    $('#convEmpty').hidden=!!mode; $('#convOpenOther').hidden=!mode; $('#convGo').disabled=!mode;
    $('#convPdfOpts').hidden=mode!=='pdf'; $('#convImgOpts').hidden=mode!=='img';
    $('#convDpiRow').hidden=to()==='txt';
    $('#convInfo').textContent= mode==='pdf'?`${file.name} · ${file.pages} página(s)` : mode==='img'?`${imgs.length} imagem(ns) → PDF`:'Abra um PDF ou imagens.';
    $('#convGo').textContent= mode==='img'?'Criar PDF e salvar':'Converter e salvar';
    grid.innerHTML='';
    if(mode==='pdf') for(let i=0;i<Math.min(file.pages,200);i++){
      const c=document.createElement('div'); c.className='card'; c.style.cursor='default';
      c.innerHTML=`<div class="thumb"></div><div class="lab">${i+1}</div>`; lazyThumb(c.querySelector('.thumb'),()=>file.pdf.getPage(i+1),130,150); grid.appendChild(c);
    }
    if(mode==='img') imgs.forEach((im,i)=>{
      const c=document.createElement('div'); c.className='card'; c.draggable=true;
      c.innerHTML=`<div class="thumb"><img alt=""></div><div class="lab" title="${esc(im.file.name)}">${i+1}. ${esc(im.file.name)}</div>
        <div class="acts"><button data-a="x" title="Remover">${ICON.del}</button></div>`;
      c.querySelector('img').src=im.url;
      c.querySelector('.acts').onclick=ev=>{ ev.stopPropagation(); URL.revokeObjectURL(im.url); imgs.splice(i,1); if(!imgs.length) mode=null; render(); };
      grid.appendChild(c);
    });
    if(mode==='img'){ const add=document.createElement('div'); add.className='card'; add.style.cursor='pointer'; add.style.justifyContent='center';
      add.innerHTML='<div class="thumb"><div class="blank" style="font-size:26px;color:var(--accent)">+</div></div><div class="lab">Adicionar imagens</div>';
      add.onclick=async()=>{ const fs=await pick({accept:'image/*',multiple:true}); if(fs.length) load(fs); }; grid.appendChild(add); }
  }
  makeSortable(grid,'.card[draggable="true"]',(a,b)=>{ moveItem(imgs,a,b); render(); },true);
  $$('input[name="convTo"]').forEach(r=>r.addEventListener('change',render));
  async function imageToPdf(){
    const out=await PDFDocument.create(); const ps=$('#convPageSize').value, m=+$('#convMargin').value;
    for(let k=0;k<imgs.length;k++){
      busySub(`imagem ${k+1} de ${imgs.length}`);
      const f=imgs[k].file; const bmp=await createImageBitmap(f); // applies EXIF orientation
      const c=document.createElement('canvas'); c.width=bmp.width; c.height=bmp.height; const g=c.getContext('2d');
      const png=/png|gif|webp/i.test(f.type);
      if(!png){ g.fillStyle='#fff'; g.fillRect(0,0,c.width,c.height); }
      g.drawImage(bmp,0,0); bmp.close&&bmp.close();
      const blob=await new Promise(r=>c.toBlob(r,png?'image/png':'image/jpeg',0.92)); c.width=c.height=0;
      const bytes=new Uint8Array(await blob.arrayBuffer());
      const img=png?await out.embedPng(bytes):await out.embedJpg(bytes);
      const iw=img.width*0.75, ih=img.height*0.75; let pw,ph;
      if(ps==='fit'){ pw=iw+2*m; ph=ih+2*m; }
      else { const base=ps==='a4'?[595.28,841.89]:[612,792]; const land=iw>ih; pw=land?base[1]:base[0]; ph=land?base[0]:base[1]; }
      const s=Math.min((pw-2*m)/iw,(ph-2*m)/ih,ps==='fit'?1:Infinity);
      const dw=iw*s, dh=ih*s; const pg=out.addPage([pw,ph]);
      pg.drawImage(img,{x:(pw-dw)/2,y:(ph-dh)/2,width:dw,height:dh});
      await tick();
    }
    return out.save();
  }
  async function pdfToText(pages){
    const parts=[];
    for(const i of pages){
      busySub(`página ${i+1}`);
      const p=await file.pdf.getPage(i+1); const tc=await p.getTextContent();
      let s=''; let lastY=null;
      for(const it of tc.items){
        if(lastY!==null && Math.abs(it.transform[5]-lastY)>2 && !s.endsWith('\n')) s+='\n';
        s+=it.str; if(it.hasEOL) s+='\n'; lastY=it.transform[5];
      }
      parts.push(`===== Página ${i+1} =====\n`+s.trim()+'\n');
    }
    return '﻿'+parts.join('\n');
  }
  $('#convGo').onclick=async()=>{
    busy(true,'Convertendo…');
    try{
      if(mode==='img'){ const b=await imageToPdf(); if(await download(b, baseName(imgs[0].file.name)+(imgs.length>1?' e outras':'')+'.pdf')) toast('PDF criado com '+imgs.length+' página(s).'); return; }
      let pages; try{ pages=rangesFlat($('#convPages').value,file.pages); }catch(err){ toast(err.message,true); return; }
      const base=baseName(file.name);
      if(to()==='txt'){ const t=await pdfToText(pages); const ok=await download(new Blob([t],{type:'text/plain;charset=utf-8'}), base+'.txt','text/plain');
        if(ok) toast(t.replace(/=+ Página \d+ =+|\s/g,'').length?'Texto extraído.':'Este PDF não tem texto selecionável (talvez seja digitalizado).', !t.replace(/=+ Página \d+ =+|\s/g,'').length); return; }
      const dpi=+$('#convDpi').value, type=to()==='png'?'image/png':'image/jpeg', ext=to();
      const outs=[];
      for(const i of pages){ busySub(`página ${i+1} de ${file.pages}`);
        const p=await file.pdf.getPage(i+1); const blob=await renderPageImage(p,dpi,type,0.9);
        outs.push({name:`${base} - pág ${i+1}.${ext}`, data:new Uint8Array(await blob.arrayBuffer()), mime:type}); await tick(); }
      if(await saveMany(outs, `${base} - imagens.zip`)) toast(outs.length+' imagem(ns) gerada(s).');
    }catch(err){ console.error(err); toast('Erro ao converter: '+friendlyError(err),true); }
    finally{ busy(false); }
  };
  wirePick('conv',{accept:'.pdf,application/pdf,image/*',multiple:true},load);
  dropZone($('#convWork'),load);
  views.convert={};
  window.__conv={load};
})();
