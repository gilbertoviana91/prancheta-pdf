// =====================================================================
// numbering (page numbers + header/footer) and OCR
// =====================================================================
const { pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextRenderingMode,
        TextRenderingMode, setCharacterSqueeze, setTextMatrix, showText } = PDFLib;

// ---------------------------------------------------------------------
// NUMERAR
// ---------------------------------------------------------------------
(function(){
  let file=null, cur=0, renderTok=0;
  const stdMetrics={};
  function metricsFor(key,bold){
    const s=Fonts.info(key), name=s.pdf[bold?'b':'r'];
    return stdMetrics[name]||(stdMetrics[name]=PDFLib.StandardFontEmbedder.for(name));
  }
  function opts(){
    const fmt=$('#numFmt').value;
    return {
      numOn:$('#numOn').checked, fmt: fmt==='custom' ? ($('#numCustom').value||'{n}') : fmt, pos:$('#numPos').value,
      start:parseInt($('#numStart').value)||0,
      hfOn:$('#hfOn').checked && !!$('#hfText').value.trim(), hfText:$('#hfText').value, hfPos:$('#hfPos').value,
      font:$('#numFont').value, size:Math.max(5,Math.min(48,+$('#numSize').value||10)), bold:$('#numBold').checked,
      color:$('#numColor').value, margin:Math.max(2,+$('#numMargin').value||10)*72/25.4, pages:$('#numPages').value
    };
  }
  function today(){ const d=new Date(); return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear(); }
  function fill(tpl,n,total){ return tpl.replace(/\{n\}/g,n).replace(/\{total\}/g,total).replace(/\{data\}/g,today()).replace(/\{arquivo\}/g,baseName(file.name)); }
  // plan: for each page index -> list of {text,pos}
  function plan(o){
    const idx=rangesFlat(o.pages,file.pages); const total=o.start-1+idx.length; const map=new Map();
    idx.forEach((pi,k)=>{ const list=[]; const n=o.start+k;
      if(o.numOn) list.push({text:fill(o.fmt,n,total),pos:o.pos});
      if(o.hfOn) list.push({text:fill(o.hfText,n,total),pos:o.hfPos});
      if(list.length) map.set(pi,list); });
    return map;
  }
  // layout in view coordinates (points, top-left origin)
  function layout(pos,w,o,W,H){
    const x = pos[1]==='l' ? o.margin : pos[1]==='r' ? W-o.margin-w : (W-w)/2;
    const baseline = pos[0]==='t' ? o.margin+o.size*0.75 : H-o.margin;
    return {x, baseline};
  }
  async function load(fs){
    const f=fs.find(isPdfFile); if(!f){ toast('Escolha um PDF.',true); return; }
    busy(true,'Abrindo PDF…');
    try{ file=await openPdfFile(f); cur=0; $('#numEmpty').hidden=true; $('#numPrevWrap').hidden=false; $('#numOpenOther').hidden=false; $('#numGo').disabled=false;
      $('#numInfo').textContent=`${file.name} · ${file.pages} página(s)`; await preview(); }
    catch(err){ toast('Não consegui abrir: '+friendlyError(err),true); }
    finally{ busy(false); }
  }
  async function preview(){
    if(!file) return;
    const tok=++renderTok; const o=opts();
    $('#numCustom').hidden=$('#numFmt').value!=='custom';
    $('#numPageLbl').textContent=`Página ${cur+1} de ${file.pages}`;
    const box=$('#numPage');
    const p=await file.pdf.getPage(cur+1); const vp1=p.getViewport({scale:1});
    const work=$('#numWork').getBoundingClientRect();
    const sc=Math.min((work.height-90)/vp1.height,(work.width-60)/vp1.width,1.6);
    if(box._key!==cur+'|'+sc){
      const c=await renderThumb(p, vp1.width*sc, vp1.height*sc); if(tok!==renderTok) return;
      c.style.width=vp1.width*sc+'px'; c.style.height=vp1.height*sc+'px';
      box.innerHTML=''; box.appendChild(c); box._key=cur+'|'+sc;
    }
    box.querySelectorAll('.stamp').forEach(n=>n.remove());
    let m; try{ m=plan(o); }catch(err){ $('#numInfo').textContent=err.message; return; }
    $('#numInfo').textContent=`${file.name} · ${file.pages} página(s)`;
    const list=m.get(cur)||[]; const met=metricsFor(o.font,o.bold);
    for(const s of list){
      const w=met.widthOfTextAtSize(s.text.replace(/[^\x20-\xff]/g,'?'),o.size); const L=layout(s.pos,w,o,vp1.width,vp1.height);
      const d=document.createElement('div'); d.className='stamp'; d.textContent=s.text;
      d.style.cssText+=`left:${L.x*sc}px;top:${(L.baseline-o.size*0.86)*sc}px;font-size:${o.size*sc}px;font-family:${Fonts.info(o.font).css};font-weight:${o.bold?700:400};color:${o.color}`;
      box.appendChild(d);
    }
    if(!list.length){ const d=document.createElement('div'); d.className='stamp'; d.style.cssText='left:8px;top:8px;font-size:12px;color:#889;outline:none'; d.textContent='(nada nesta página)'; box.appendChild(d); }
  }
  ['numOn','numFmt','numCustom','numPos','numStart','hfOn','hfText','hfPos','numFont','numSize','numBold','numColor','numMargin','numPages']
    .forEach(id=>{ const n=$('#'+id); n.addEventListener('input',preview); n.addEventListener('change',preview); });
  $('#numPrevPage').onclick=()=>{ if(file&&cur>0){ cur--; preview(); } };
  $('#numNextPage').onclick=()=>{ if(file&&cur<file.pages-1){ cur++; preview(); } };
  window.addEventListener('resize',()=>{ if(App.view==='number') preview(); });
  $('#numGo').onclick=async()=>{
    const o=opts(); let m; try{ m=plan(o); }catch(err){ toast(err.message,true); return; }
    if(!m.size){ toast('Marque números de página ou escreva um texto de cabeçalho/rodapé.',true); return; }
    busy(true,'Numerando…');
    try{
      const doc=await loadPdfLib(file.bytes); const pages=doc.getPages(); const cache={};
      const fe=await embedFontFor(doc,cache,o.font,o.bold,false); let warned=false;
      for(const [i,list] of m){
        const p=await file.pdf.getPage(i+1); const vp=p.getViewport({scale:1}); const rot=((vp.rotation%360)+360)%360;
        for(const s of list){
          const txt=cleanForFont(fe,s.text); if(txt!==s.text) warned=true;
          const w=fe.font.widthOfTextAtSize(txt,o.size); const L=layout(s.pos,w,o,vp.width,vp.height);
          const [x,y]=vp.convertToPdfPoint(L.x,L.baseline);
          pages[i].drawText(txt,{x,y,size:o.size,font:fe.font,color:hexToRgb(o.color),rotate:degrees(rot)});
        }
      }
      const out=await doc.save();
      if(await download(out, baseName(file.name)+' - numerado.pdf')) toast(warned?'PDF salvo; caracteres especiais viraram "?".':`Numeração aplicada em ${m.size} página(s).`, warned);
    }catch(err){ console.error(err); toast('Erro: '+friendlyError(err),true); }
    finally{ busy(false); }
  };
  wirePick('num',{accept:'.pdf,application/pdf'},load);
  dropZone($('#numWork'),load);
  views.number={ onShow(){ if(file) preview(); } };
  window.__num={load};
})();

// ---------------------------------------------------------------------
// OCR (Tesseract, running fully offline from assets embedded in this file)
// ---------------------------------------------------------------------
const Ocr=(function(){
  let worker=null, workerPromise=null, progressCb=null;
  function getWorker(){
    if(worker) return Promise.resolve(worker);
    if(workerPromise) return workerPromise;
    workerPromise=(async()=>{
      const core=$('#ocrCoreSrc').textContent, wsrc=$('#ocrWorkerSrc').textContent, lang=$('#ocrLangB64').textContent.trim();
      if(core.length<1000 || lang.length<1000) throw new Error('Os componentes de OCR não estão neste arquivo.');
      const prelude=`self.__PL=${JSON.stringify(lang)};(function(){var of=self.fetch;self.fetch=function(u,o){if(String(u).indexOf('traineddata')>=0){var b=atob(self.__PL),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return Promise.resolve(new Response(a));}return of.apply(this,arguments);};})();\n`;
      const url=URL.createObjectURL(new Blob([prelude,core,'\n;\n',wsrc],{type:'text/javascript'}));
      worker=await Tesseract.createWorker('por',1,{workerPath:url, workerBlobURL:false, langPath:'local', cacheMethod:'none', gzip:true,
        logger:m=>{ if(progressCb) progressCb(m); }});
      return worker;
    })();
    workerPromise.catch(()=>{ workerPromise=null; });
    return workerPromise;
  }
  async function recognizePage(page, dpi){
    const vp=page.getViewport({scale:dpi/72});
    const c=document.createElement('canvas'); c.width=Math.round(vp.width); c.height=Math.round(vp.height);
    const g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,c.width,c.height);
    await page.render({canvasContext:g,viewport:vp}).promise;
    const w=await getWorker();
    const {data}=await w.recognize(c,{},{text:true,blocks:true});
    c.width=c.height=0;
    const words=[];
    for(const b of (data.blocks||[])) for(const par of (b.paragraphs||[])) for(const ln of (par.lines||[])) for(const wd of (ln.words||[])) words.push({...wd, line:ln});
    if(!words.length && data.words) data.words.forEach(wd=>words.push(wd));
    return {text:data.text||'', words, scale:dpi/72};
  }
  // add an invisible, selectable text layer to a pdf-lib page
  function addTextLayer(page, font, words, scale, vp1){
    const rot=((vp1.rotation%360)+360)%360, th=rot*Math.PI/180, cos=Math.cos(th), sin=Math.sin(th);
    const key=page.node.newFontDictionary('OCR', font.ref);
    const ops=[pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
    let count=0;
    for(const wd of words){
      if(!wd.text || !wd.text.trim() || (wd.confidence!==undefined && wd.confidence<25)) continue;
      let txt=''; for(const ch of wd.text.trim()){ try{ font.encodeText(ch); txt+=ch; }catch(_){ txt+='?'; } }
      const b=wd.bbox; const wPt=(b.x1-b.x0)/scale;
      const rowH = wd.line && wd.line.rowAttributes && wd.line.rowAttributes.row_height ? wd.line.rowAttributes.row_height : (b.y1-b.y0);
      const size=Math.max(2, rowH/scale*0.85);
      let by=b.y1-(b.y1-b.y0)*0.2;
      const bl=wd.baseline || (wd.line && wd.line.baseline);
      if(bl && bl.has_baseline!==false && bl.x1!==bl.x0){ by=bl.y0+(bl.y1-bl.y0)*((b.x0-bl.x0)/(bl.x1-bl.x0)); }
      const [ox,oy]=vp1.convertToPdfPoint(b.x0/scale, by/scale);
      const nat=font.widthOfTextAtSize(txt,size)||1; const tz=Math.max(20,Math.min(400,100*wPt/nat));
      ops.push(setFontAndSize(key,size), setCharacterSqueeze(tz), setTextMatrix(cos,sin,-sin,cos,ox,oy), showText(font.encodeText(txt)));
      count++;
    }
    ops.push(endText(), popGraphicsState());
    if(count) page.pushOperators(...ops);
    return count;
  }

  // ---------- UI ----------
  const grid=$('#ocrGrid'); let file=null, lastText='';
  async function load(fs){
    const f=fs.find(isPdfFile); if(!f){ toast('Escolha um PDF.',true); return; }
    busy(true,'Abrindo PDF…');
    try{ file=await openPdfFile(f); lastText=''; render(); } catch(err){ toast('Não consegui abrir: '+friendlyError(err),true); } finally{ busy(false); }
  }
  function render(){
    $('#ocrEmpty').hidden=!!file; $('#ocrOpenOther').hidden=!file; $('#ocrGo').disabled=!file; $('#ocrTxt').disabled=!lastText;
    $('#ocrInfo').textContent=file?`${file.name} · ${file.pages} página(s)`:'Abra um PDF digitalizado.';
    $('#ocrResult').textContent=file?'Pronto para reconhecer.':'—';
    grid.innerHTML='';
    if(file) for(let i=0;i<Math.min(file.pages,200);i++){
      const c=document.createElement('div'); c.className='card'; c.style.cursor='default';
      c.innerHTML=`<div class="thumb"></div><div class="lab">${i+1}</div><span class="badge" hidden></span>`;
      lazyThumb(c.querySelector('.thumb'),()=>file.pdf.getPage(i+1),130,150); grid.appendChild(c);
    }
  }
  function badge(i,txt){ const c=grid.children[i]; if(!c) return; const b=c.querySelector('.badge'); b.hidden=false; b.textContent=txt; }
  $('#ocrGo').onclick=async()=>{
    let pages; try{ pages=rangesFlat($('#ocrPages').value,file.pages); }catch(err){ toast(err.message,true); return; }
    const dpi=+document.querySelector('input[name="ocrQ"]:checked').value, skip=$('#ocrSkip').checked;
    busy(true,'Preparando o OCR…','carregando o reconhecedor (só na primeira vez)');
    try{
      progressCb=null; await getWorker();
      const doc=await loadPdfLib(file.bytes); const font=await doc.embedFont(StandardFonts.Helvetica);
      const pdfPages=doc.getPages(); let done=0, words=0, skipped=0; const texts=[];
      for(const i of pages){
        done++;
        const p=await file.pdf.getPage(i+1);
        if(skip){ const tc=await p.getTextContent(); const n=tc.items.reduce((s,it)=>s+(it.str||'').trim().length,0);
          if(n>20){ skipped++; badge(i,'já tinha texto'); texts.push(`===== Página ${i+1} =====\n`+tc.items.map(it=>it.str+(it.hasEOL?'\n':'')).join('')); continue; } }
        busy(true,`Reconhecendo texto… página ${done} de ${pages.length}`,'');
        progressCb=m=>{ if(m.status==='recognizing text') busySub(Math.round(m.progress*100)+'%'); };
        const r=await recognizePage(p,dpi);
        const vp1=p.getViewport({scale:1});
        const n=addTextLayer(pdfPages[i],font,r.words,r.scale,vp1); words+=n;
        badge(i, n? n+' palavras' : 'sem texto');
        texts.push(`===== Página ${i+1} =====\n`+r.text.trim());
        await tick();
      }
      progressCb=null;
      lastText='﻿'+texts.join('\n\n'); $('#ocrTxt').disabled=false;
      $('#ocrResult').innerHTML=`<b>${words}</b> palavras reconhecidas em ${pages.length-skipped} página(s)`+(skipped?` · ${skipped} já tinham texto`:'');
      if(!words){ toast(skipped?'Todas as páginas escolhidas já tinham texto; nada a fazer.':'Nenhum texto foi reconhecido.', !skipped); return; }
      const out=await doc.save({updateFieldAppearances:false});
      if(await download(out, baseName(file.name)+' - pesquisável.pdf')) toast('PDF pesquisável salvo.');
    }catch(err){ console.error(err); toast('Erro no OCR: '+friendlyError(err),true); }
    finally{ progressCb=null; busy(false); }
  };
  $('#ocrTxt').onclick=()=>{ if(lastText) download(new Blob([lastText],{type:'text/plain;charset=utf-8'}), baseName(file.name)+' - texto OCR.txt','text/plain'); };
  wirePick('ocr',{accept:'.pdf,application/pdf'},load);
  dropZone($('#ocrWork'),load);
  views.ocr={};
  window.__ocr={load};
  return {getWorker, recognizePage, addTextLayer};
})();
