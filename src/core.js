// =====================================================================
// core: shared helpers, pdf.js worker, navigation, download, zip, fonts
// =====================================================================
(function(){
  const b64 = document.getElementById('pdfjsWorkerB64').textContent.trim();
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes],{type:'text/javascript'}));
  pdfjsLib.GlobalWorkerOptions.workerSrc = url;
  try{ pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(url); }catch(e){ console.warn('worker', e); }
})();

const { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFString, PDFNumber, PDFArray, PDFDict,
        PDFRawStream, PDFRef, PDFHexString, decodePDFRawStream } = PDFLib;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function toast(msg, bad){ const t=$('#toast'); t.textContent=msg; t.classList.toggle('bad',!!bad); t.classList.add('show');
  clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'), bad?5000:2600); }
function busy(on, msg, sub){ $('#busy').classList.toggle('show',!!on); $('#busyMsg').textContent=msg||'Processando…'; $('#busySub').textContent=sub||''; }
function busySub(sub){ $('#busySub').textContent=sub||''; }
const tick = () => new Promise(r=>setTimeout(r,0));
function hexToRgb(h){ const n=parseInt(h.slice(1),16); return rgb(((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255); }
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function fmtBytes(n){ if(n<1024) return n+' B'; if(n<1048576) return (n/1024).toFixed(0)+' KB'; return (n/1048576).toFixed(n<10485760?2:1)+' MB'; }
function baseName(name){ return String(name||'documento').replace(/\.[^.]+$/,''); }
function isPdfFile(f){ return /\.pdf$/i.test(f.name) || f.type==='application/pdf'; }
function isImageFile(f){ return /^image\/(jpeg|png|webp|gif|bmp)$/i.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name); }
async function readBytes(file){ return new Uint8Array(await file.arrayBuffer()); }
async function loadPdfJs(bytes){ return pdfjsLib.getDocument({data: bytes.slice()}).promise; }
async function loadPdfLib(bytes){ return PDFDocument.load(bytes,{ignoreEncryption:true}); }
function friendlyError(err){
  const m=String((err&&err.message)||err);
  if(/password|encrypt/i.test(m)) return 'O PDF está protegido por senha.';
  if(/Invalid PDF|No PDF header|Failed to parse/i.test(m)) return 'O arquivo não parece ser um PDF válido.';
  return m;
}

// ---------- navigation ----------
const views = {};
function showView(name){
  $$('#nav button').forEach(b=>b.classList.toggle('on',b.dataset.view===name));
  $$('.view').forEach(v=>v.classList.toggle('on',v.dataset.view===name));
  App.view=name;
  if(views[name] && views[name].onShow) views[name].onShow();
}
const App = { view:'editor' };
$$('#nav button').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));

// generic file picker: pick({accept, multiple}) -> Promise<File[]>
function pick(opts){
  return new Promise(res=>{
    const inp=$('#pickAny'); inp.value=''; inp.accept=opts.accept||''; inp.multiple=!!opts.multiple;
    inp.onchange=()=>res([...inp.files]); inp.click();
  });
}
// drag & drop helper
function dropZone(el, onFiles){
  ['dragenter','dragover'].forEach(t=>el.addEventListener(t,ev=>{ if(!ev.dataTransfer || ![...ev.dataTransfer.types].includes('Files')) return; ev.preventDefault(); el.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(t=>el.addEventListener(t,ev=>{ if(t==='dragleave' && el.contains(ev.relatedTarget)) return; el.classList.remove('dragover'); }));
  el.addEventListener('drop',ev=>{ if(!ev.dataTransfer || !ev.dataTransfer.files.length) return; ev.preventDefault(); onFiles([...ev.dataTransfer.files]); });
}

// ---------- download ----------
async function download(bytes, name, mime){
  mime = mime || 'application/pdf';
  if(window.__dl){ window.__dl(bytes,name,mime); return true; }
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes],{type:mime});
  const ext = (name.match(/\.([a-z0-9]+)$/i)||[,'pdf'])[1].toLowerCase();
  if(window.showSaveFilePicker){
    try{
      const h=await showSaveFilePicker({suggestedName:name,types:[{description:ext.toUpperCase(),accept:{[mime]:['.'+ext]}}]});
      const w=await h.createWritable(); await w.write(blob); await w.close(); return true;
    }catch(e){ if(e && e.name==='AbortError') return false; console.warn(e); }
  }
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },4000);
  return true;
}

// ---------- minimal ZIP writer (store, UTF-8 names) ----------
const CRC_TABLE=(()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c>>>0; } return t; })();
function crc32(b){ let c=0xFFFFFFFF; for(let i=0;i<b.length;i++) c=CRC_TABLE[(c^b[i])&255]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
function makeZip(files){ // files: [{name, data:Uint8Array}]
  const enc=new TextEncoder(), parts=[], central=[]; let offset=0;
  const d=new Date(), dosTime=(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1), dosDate=((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
  for(const f of files){
    const name=enc.encode(f.name), crc=crc32(f.data), size=f.data.length;
    const h=new DataView(new ArrayBuffer(30));
    h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(6,0x0800,true); h.setUint16(8,0,true);
    h.setUint16(10,dosTime,true); h.setUint16(12,dosDate,true); h.setUint32(14,crc,true); h.setUint32(18,size,true); h.setUint32(22,size,true);
    h.setUint16(26,name.length,true); h.setUint16(28,0,true);
    parts.push(new Uint8Array(h.buffer),name,f.data);
    const c=new DataView(new ArrayBuffer(46));
    c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x0800,true); c.setUint16(10,0,true);
    c.setUint16(12,dosTime,true); c.setUint16(14,dosDate,true); c.setUint32(16,crc,true); c.setUint32(20,size,true); c.setUint32(24,size,true);
    c.setUint16(28,name.length,true); c.setUint32(42,offset,true);
    central.push(new Uint8Array(c.buffer),name);
    offset+=30+name.length+size;
  }
  const cdSize=central.reduce((s,p)=>s+p.length,0);
  const e=new DataView(new ArrayBuffer(22));
  e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true); e.setUint32(12,cdSize,true); e.setUint32(16,offset,true);
  return new Blob([...parts,...central,new Uint8Array(e.buffer)],{type:'application/zip'});
}
async function saveMany(files, zipName){
  if(files.length===1) return download(files[0].data, files[0].name, files[0].mime);
  return download(makeZip(files), zipName, 'application/zip');
}

// ---------- page ranges: "1-3, 5, 8-" -> [[0,1,2],[4],[7..n-1]] (0-based) ----------
function parseRanges(text, total){
  const out=[]; const s=String(text||'').trim(); if(!s) return null;
  for(const part of s.split(/[,;]+/)){
    const p=part.trim(); if(!p) continue;
    let m;
    if((m=p.match(/^(\d+)$/))){ const a=+m[1]; if(a<1||a>total) throw new Error(`Página ${a} não existe (o PDF tem ${total}).`); out.push([a-1]); }
    else if((m=p.match(/^(\d*)\s*-\s*(\d*)$/))){
      const a=m[1]?+m[1]:1, b=m[2]?+m[2]:total;
      if(a<1||b>total||a>b) throw new Error(`Intervalo "${p}" inválido (o PDF tem ${total} páginas).`);
      const r=[]; for(let i=a;i<=b;i++) r.push(i-1); out.push(r);
    } else throw new Error(`Não entendi "${p}". Use algo como 1-3, 5, 8-`);
  }
  return out;
}
function rangesFlat(text,total){ const r=parseRanges(text,total); if(!r){ return [...Array(total).keys()]; } return r.flat(); }

// ---------- thumbnails ----------
async function renderThumb(page, maxW, maxH, extraRotate){
  const vp0=page.getViewport({scale:1, rotation:(page.rotate+(extraRotate||0))%360});
  const scale=Math.min(maxW/vp0.width, maxH/vp0.height)*Math.min(window.devicePixelRatio||1,2);
  const vp=page.getViewport({scale, rotation:(page.rotate+(extraRotate||0))%360});
  const c=document.createElement('canvas'); c.width=Math.ceil(vp.width); c.height=Math.ceil(vp.height);
  c.style.width=(vp.width/Math.min(window.devicePixelRatio||1,2))+'px';
  await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
  return c;
}
// render a pdf.js page to an image blob at a given dpi
async function renderPageImage(page, dpi, type, quality){
  const vp=page.getViewport({scale:dpi/72});
  const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(vp.width)); c.height=Math.max(1,Math.round(vp.height));
  const ctx=c.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height);
  await page.render({canvasContext:ctx,viewport:vp}).promise;
  const blob=await new Promise(r=>c.toBlob(r,type,quality));
  c.width=c.height=0;
  return blob;
}

// ---------- sortable lists (pointer-based drag to reorder) ----------
function makeSortable(container, itemSelector, onMove, horizontal){
  let dragEl=null, overEl=null, after=false;
  container.addEventListener('dragstart',ev=>{
    const it=ev.target.closest(itemSelector); if(!it) return;
    dragEl=it; it.classList.add('dragging'); ev.dataTransfer.effectAllowed='move'; ev.dataTransfer.setData('text/plain','x');
  });
  container.addEventListener('dragover',ev=>{
    if(!dragEl) return; ev.preventDefault();
    const it=ev.target.closest(itemSelector); clearMarks();
    if(!it || it===dragEl){ overEl=null; return; }
    const r=it.getBoundingClientRect();
    after = horizontal ? (ev.clientX > r.left+r.width/2) : (ev.clientY > r.top+r.height/2);
    overEl=it; it.classList.add(after?'drop-after':'drop-before');
  });
  container.addEventListener('drop',ev=>{
    if(!dragEl) return; ev.preventDefault();
    const items=[...container.querySelectorAll(itemSelector)];
    const from=items.indexOf(dragEl); let to=overEl?items.indexOf(overEl):-1;
    clearMarks(); dragEl.classList.remove('dragging'); dragEl=null;
    if(to<0||from<0) return;
    if(after) to++; if(from<to) to--;
    if(to!==from) onMove(from,to);
  });
  container.addEventListener('dragend',()=>{ if(dragEl) dragEl.classList.remove('dragging'); dragEl=null; clearMarks(); });
  function clearMarks(){ container.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after')); }
}
function moveItem(arr,from,to){ const [x]=arr.splice(from,1); arr.splice(to,0,x); }

// =====================================================================
// fonts: standard PDF fonts + fonts installed on this computer
// =====================================================================
const Fonts = {
  std: [
    {key:'std:Helvetica', label:'Helvetica (Arial)', css:'Arial, Helvetica, sans-serif',
      pdf:{r:StandardFonts.Helvetica,b:StandardFonts.HelveticaBold,i:StandardFonts.HelveticaOblique,bi:StandardFonts.HelveticaBoldOblique}},
    {key:'std:Times', label:'Times New Roman', css:'"Times New Roman", Times, serif',
      pdf:{r:StandardFonts.TimesRoman,b:StandardFonts.TimesRomanBold,i:StandardFonts.TimesRomanItalic,bi:StandardFonts.TimesRomanBoldItalic}},
    {key:'std:Courier', label:'Courier New', css:'"Courier New", Courier, monospace',
      pdf:{r:StandardFonts.Courier,b:StandardFonts.CourierBold,i:StandardFonts.CourierOblique,bi:StandardFonts.CourierBoldOblique}},
  ],
  // fonts bundled inside this HTML (open-source, metric-compatible with the usual corporate fonts)
  emb: [
    {key:'emb:Arial',   label:'Arial',            sub:'Liberation Sans',  family:'PR Arial',   files:{r:'LiberationSans-Regular',b:'LiberationSans-Bold',i:'LiberationSans-Italic',bi:'LiberationSans-BoldItalic'}, fb:'Arial, sans-serif'},
    {key:'emb:Calibri', label:'Calibri',          sub:'Carlito',          family:'PR Calibri', subset:false, files:{r:'Carlito-Regular',b:'Carlito-Bold',i:'Carlito-Italic',bi:'Carlito-BoldItalic'}, fb:'Calibri, sans-serif'},
    {key:'emb:Cambria', label:'Cambria',          sub:'Caladea',          family:'PR Cambria', subset:false, files:{r:'Caladea-Regular',b:'Caladea-Bold',i:'Caladea-Italic',bi:'Caladea-BoldItalic'}, fb:'Cambria, serif'},
    {key:'emb:Times',   label:'Times New Roman',  sub:'Liberation Serif', family:'PR Times',   files:{r:'LiberationSerif-Regular',b:'LiberationSerif-Bold',i:'LiberationSerif-Italic',bi:'LiberationSerif-BoldItalic'}, fb:'"Times New Roman", serif'},
    {key:'emb:Courier', label:'Courier New',      sub:'Liberation Mono',  family:'PR Courier', files:{r:'LiberationMono-Regular',b:'LiberationMono-Bold',i:'LiberationMono-Italic',bi:'LiberationMono-BoldItalic'}, fb:'"Courier New", monospace'},
    {key:'emb:DejaVu',  label:'DejaVu Sans (símbolos ✓ ☑ → ●)', sub:'DejaVu Sans', family:'PR DejaVu', files:{r:'DejaVuSans',b:'DejaVuSans-Bold'}, fb:'Verdana, sans-serif'},
  ],
  _bytes:{}, _faces:{}, _loaded:new Set(),
  isLoaded(k){ return !k || !k.startsWith('emb:') || this._loaded.has(k); },
  async embBytes(name){
    if(this._bytes[name]) return this._bytes[name];
    const el=document.getElementById('font-'+name); if(!el) throw new Error('Fonte '+name+' não incluída neste arquivo.');
    const b64=el.textContent.trim(); const bin=atob(b64); const gz=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) gz[i]=bin.charCodeAt(i);
    const ds=new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
    const out=new Uint8Array(await new Response(ds).arrayBuffer());
    return (this._bytes[name]=out);
  },
  // make the bundled family available to the page (preview) — resolves when loaded
  ensure(key){
    if(!key || !key.startsWith('emb:')) return Promise.resolve();
    if(this._faces[key]) return this._faces[key];
    const f=this.emb.find(x=>x.key===key); if(!f) return Promise.resolve();
    const pr=(this._faces[key]=(async()=>{
      for(const [k,name] of Object.entries(f.files)){
        const bytes=await this.embBytes(name);
        const face=new FontFace(f.family, bytes, {weight:k.includes('b')?'700':'400', style:k.includes('i')?'italic':'normal'});
        await face.load(); document.fonts.add(face);
      }
      for(const id in this._bl) if(id.startsWith(key+'|')) delete this._bl[id];
      this._loaded.add(key);
    })());
    pr.catch(()=>{ delete this._faces[key]; });
    return pr;
  },
  local: null,          // Map family -> {r,b,i,bi : FontData}
  supported: typeof window.queryLocalFonts === 'function',
  async loadLocal(){
    if(!this.supported) throw new Error('Este navegador não permite listar as fontes instaladas. Use o Edge ou o Chrome atualizados.');
    const list = await window.queryLocalFonts();
    const map = new Map();
    for(const f of list){
      const st=(f.style||'').toLowerCase();
      const bold=/bold|black|heavy|semibold|demibold/.test(st) && !/semilight/.test(st);
      const ital=/italic|oblique/.test(st);
      const plain=/^(regular|normal|book|roman|)$/.test(st.trim());
      if(!map.has(f.family)) map.set(f.family,{});
      const v=map.get(f.family);
      const k = bold&&ital?'bi':bold?'b':ital?'i':'r';
      // prefer exact "Bold"/"Regular" over weights like Semibold/Medium
      const exact = (k==='r'&&plain) || (k==='b'&&/^bold$/.test(st)) || (k==='i'&&/^(italic|oblique)$/.test(st)) || (k==='bi'&&/^bold (italic|oblique)$/.test(st));
      if(!v[k] || (exact && !v[k+'_exact'])){ v[k]=f; if(exact) v[k+'_exact']=true; }
    }
    // drop families without any usable face
    for(const [fam,v] of map){ if(!v.r){ const any=v.b||v.i||v.bi; if(any) v.r=any; else map.delete(fam); } }
    this.local = new Map([...map.entries()].sort((a,b)=>a[0].localeCompare(b[0],'pt-BR')));
    return this.local.size;
  },
  info(key){
    if(key.startsWith('std:')) return this.std.find(s=>s.key===key) || this.std[0];
    if(key.startsWith('emb:')){ const f=this.emb.find(x=>x.key===key)||this.emb[0]; return {...f, css:`"${f.family}", ${f.fb}`}; }
    const fam=key.slice(6); const v=this.local && this.local.get(fam);
    return { key, label:fam, css:`"${fam.replace(/"/g,'')}", Arial, sans-serif`, local:v, missing:!v };
  },
  hasVariant(key, bold, italic){
    if(key.startsWith('std:')) return true;
    if(key.startsWith('emb:')) return !!this.info(key).files[bold&&italic?'bi':bold?'b':italic?'i':'r'];
    const v=this.info(key).local; if(!v) return false;
    return !!v[bold&&italic?'bi':bold?'b':italic?'i':'r'];
  },
  // ratio of baseline offset from the top of a 1.2 line box, measured with the browser's own metrics
  _bl:{},
  baseline(key, bold, italic){
    const id=key+'|'+bold+'|'+italic; if(this._bl[id]) return this._bl[id];
    const c=document.createElement('canvas').getContext('2d');
    c.font=`${italic?'italic ':''}${bold?'bold ':''}100px ${this.info(key).css}`;
    const m=c.measureText('Hg');
    let A=m.fontBoundingBoxAscent, D=m.fontBoundingBoxDescent;
    if(!(A>0)){ A=90.5; D=21.2; }
    const r=((120-(A+D))/2 + A)/100;
    return (this._bl[id]=r);
  }
};

const isTTC = b => b[0]===0x74 && b[1]===0x74 && b[2]===0x63 && b[3]===0x66; // 'ttcf'
const fontkitShim = { create(buf){ return fontkit.create(buf); } };

// embed cache per PDFDocument
async function embedFontFor(doc, cache, key, bold, italic){
  const id=key+'|'+(bold?1:0)+(italic?1:0);
  if(cache[id]) return cache[id];
  if(key.startsWith('std:')){
    const s=Fonts.info(key); const k=bold&&italic?'bi':bold?'b':italic?'i':'r';
    return (cache[id]={font:await doc.embedFont(s.pdf[k]), std:true});
  }
  if(key.startsWith('emb:')){
    const f=Fonts.info(key); const k=bold&&italic?'bi':bold?'b':italic?'i':'r';
    const data=await Fonts.embBytes(f.files[k]||f.files.r);
    doc.registerFontkit(fontkitShim);
    const font=await doc.embedFont(data,{subset:f.subset!==false});
    return (cache[id]={font, std:false, name:f.label});
  }
  const v=Fonts.info(key).local; const k=bold&&italic?'bi':bold?'b':italic?'i':'r';
  const fd = v && (v[k]||v.r);
  if(!fd) throw new Error('A fonte "'+key.slice(6)+'" não está disponível. Clique em "Carregar fontes do computador".');
  const bytes=new Uint8Array(await (await fd.blob()).arrayBuffer());
  let data=bytes;
  if(isTTC(bytes)){ data=extractFromTTC(bytes, fd.postscriptName); if(!data) throw new Error('Não consegui ler a fonte "'+fd.fullName+'".'); }
  const isCFF = data[0]===0x4F && data[1]===0x54 && data[2]===0x54 && data[3]===0x4F; // 'OTTO' -> CFF outlines: subsetting is unreliable
  doc.registerFontkit(fontkitShim);
  let font;
  // full embedding is the safe choice: subsetting breaks some TrueType fonts silently
  if(isCFF || data.length<12e6) font=await doc.embedFont(data,{subset:false});
  else {
    try{ font=await doc.embedFont(data,{subset:true}); }
    catch(e){ console.warn('subset failed, embedding full font', e); font=await doc.embedFont(data,{subset:false}); }
  }
  return (cache[id]={font, std:false, big:data.length>3e6, name:fd.fullName});
}
// pull one font out of a TrueType/OpenType collection (.ttc/.otc) as a standalone sfnt file
function extractFromTTC(buf, psName){
  const dv=new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const num=dv.getUint32(8); let index=0;
  try{ const coll=fontkit.create(buf); const fonts=coll.fonts||[]; const k=fonts.findIndex(f=>f.postscriptName===psName); if(k>=0) index=k; }catch(_){}
  if(index>=num) index=0;
  const off=dv.getUint32(12+index*4);
  const numTables=dv.getUint16(off+4);
  const recs=[]; for(let t=0;t<numTables;t++){ const r=off+12+t*16; recs.push({tag:dv.getUint32(r), sum:dv.getUint32(r+4), o:dv.getUint32(r+8), len:dv.getUint32(r+12)}); }
  let size=12+16*numTables; recs.forEach(r=>{ size+=(r.len+3)&~3; });
  const out=new Uint8Array(size), od=new DataView(out.buffer);
  out.set(buf.subarray(off,off+12),0);
  let pos=12+16*numTables;
  recs.forEach((r,t)=>{ const h=12+t*16; od.setUint32(h,r.tag); od.setUint32(h+4,r.sum); od.setUint32(h+8,pos); od.setUint32(h+12,r.len);
    out.set(buf.subarray(r.o,r.o+r.len),pos); pos+=(r.len+3)&~3; });
  return out;
}
function cleanForFont(fontEntry, s){
  if(!fontEntry.std){ // custom font: drop glyphs the font does not have
    let out=''; for(const ch of s){ try{ const g=fontEntry.font.embedder.font.glyphForCodePoint(ch.codePointAt(0)); out+= (g && g.id!==0) || ch===' ' ? ch : '?'; }catch(_){ out+=ch; } } return out;
  }
  let out=''; for(const ch of s){ try{ fontEntry.font.encodeText(ch); out+=ch; }catch(_){ out+='?'; } } return out;
}

// ---------- text measuring & wrapping (single source of truth for preview and PDF) ----------
const _measureCtx=document.createElement('canvas').getContext('2d');
function measureText(str, key, size, bold, italic){
  _measureCtx.font=`${italic?'italic ':''}${bold?'bold ':''}${size}px ${Fonts.info(key).css}`;
  return _measureCtx.measureText(str).width;
}
function wrapText(text, maxW, key, size, bold, italic){
  const out=[];
  for(const para of String(text).split('\n')){
    const words=para.split(/(\s+)/); let line='';
    for(const w of words){
      const test=line+w;
      if(line && measureText(test.trimEnd(),key,size,bold,italic)>maxW && w.trim()){
        out.push(line.trimEnd()); line=w.trimStart();
        // hard-break very long words
        while(measureText(line,key,size,bold,italic)>maxW && line.length>1){
          let k=line.length; while(k>1 && measureText(line.slice(0,k),key,size,bold,italic)>maxW) k--;
          out.push(line.slice(0,k)); line=line.slice(k);
        }
      } else line=test;
    }
    out.push(line.trimEnd());
  }
  return out;
}

$('#btnLicenses') && ($('#btnLicenses').onclick=()=>{ const t=($('#licenses')||{}).textContent||''; const w=window.open(URL.createObjectURL(new Blob([t.replace(/<\\\//g,'</')],{type:'text/plain;charset=utf-8'})),'_blank'); if(!w) toast('Permita pop-ups para ver as licenças.'); });
