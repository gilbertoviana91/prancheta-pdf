// =====================================================================
// editor: annotate, add form fields, erase existing text
// =====================================================================
(function(){
const viewer=$('#viewer'), pagesEl=$('#pages'), propsEl=$('#props');

let pdfBytes=null, pdfJsDoc=null, fileName='';
let pageInfos=[];       // {page, vp, w,h, el, layer, canvas, rendered, task, textItems}
let elements=[];        // coords in "view points" (scale 1, top-left origin)
let selectedId=null, tool=null, zoom=1, nextId=1;
let history=[], existingFieldNames=new Set();
const counters={};
let lastText={font:'emb:Arial', size:12, color:'#000000', bold:false, italic:false, underline:false, strike:false};
Fonts.ensure('emb:Arial').then(()=>{ if(typeof renderElements==='function') renderElements(); });
let preview={doc:null, version:0, stats:{removed:0,by:{},gfx:{},graphics:0}, sig:''};
let pendingImage=null, toolBtn=null;

const TYPES={
  text:     {label:'Texto', kind:'text'},
  cross:    {label:'Símbolo X', kind:'symbol', w:14, h:14},
  check:    {label:'Símbolo ✓', kind:'symbol', w:14, h:14},
  dot:      {label:'Ponto', kind:'symbol', w:8, h:8},
  erase:    {label:'Apagar texto', kind:'erase'},
  image:    {label:'Imagem / assinatura', kind:'image'},
  table:    {label:'Tabela', kind:'table'},
  ftext:    {label:'Campo de texto', kind:'field', w:160, h:22, prefix:'texto'},
  fmulti:   {label:'Texto multilinha', kind:'field', w:220, h:64, prefix:'texto_multilinha'},
  dropdown: {label:'Lista suspensa', kind:'field', w:160, h:22, prefix:'lista'},
  radio:    {label:'Botão de opção', kind:'field', w:14, h:14, prefix:'opcao'},
  checkbox: {label:'Caixa de seleção', kind:'field', w:14, h:14, prefix:'caixa'},
  signature:{label:'Campo de assinatura', kind:'field', w:180, h:50, prefix:'assinatura'}
};
const COLORS=['#000000','#1f3fbf','#b3261e','#0f7a3a','#6b6f75'];
const COVER_COLORS=['#ffffff','#000000','#f5f1e6','#e8eef5'];
const kind=e=>TYPES[e.type].kind;

function snapshot(){ history.push(JSON.stringify(elements)); if(history.length>100) history.shift(); $('#btnUndo').disabled=false; }
function undo(){ if(!history.length) return; elements=JSON.parse(history.pop()); selectedId=null; $('#btnUndo').disabled=!history.length; renderElements(); renderProps(); schedulePreview(); }
function getEl(id){ return elements.find(e=>e.id===id); }
function allFieldNames(exceptId){ const s=new Set(); elements.forEach(e=>{ if(e.id!==exceptId && kind(e)==='field') s.add(e.name); }); return s; }
function uniqueName(prefix){
  const used=allFieldNames(); let n=(counters[prefix]||0), name;
  do { n++; name=prefix+'_'+n; } while(used.has(name) || existingFieldNames.has(name));
  counters[prefix]=n; return name;
}

// ---------- loading ----------
async function openFile(file){
  if(!file) return;
  if(!isPdfFile(file)){ toast('Escolha um arquivo PDF.', true); return; }
  if(elements.length && !confirm('Abrir outro PDF descarta as alterações atuais. Continuar?')) return;
  busy(true,'Abrindo PDF…');
  try{
    const buf=await readBytes(file);
    const doc=await loadPdfJs(buf);
    pdfBytes=buf; pdfJsDoc=doc; fileName=file.name||'documento.pdf';
    existingFieldNames=new Set();
    try{ const d=await loadPdfLib(pdfBytes); d.getForm().getFields().forEach(f=>existingFieldNames.add(f.getName())); }catch(e){}
    elements=[]; history=[]; selectedId=null; $('#btnUndo').disabled=true;
    for(const k in counters) delete counters[k];
    preview={doc:null, version:preview.version+1, stats:{removed:0,by:{},gfx:{},graphics:0}, sig:''};
    $('#filename').textContent=fileName;
    $('#empty').style.display='none';
    $('#btnSave').disabled=false;
    await buildPages();
    renderProps();
  }catch(err){ console.error(err); toast('Não consegui abrir esse PDF: '+friendlyError(err), true); }
  finally{ busy(false); }
}

async function buildPages(){
  pagesEl.innerHTML=''; pageInfos=[];
  for(let i=1;i<=pdfJsDoc.numPages;i++){
    const p=await pdfJsDoc.getPage(i);
    const vp=p.getViewport({scale:1});
    const el=document.createElement('div'); el.className='page'; el.dataset.page=i-1;
    const canvas=document.createElement('canvas');
    const layer=document.createElement('div'); layer.className='layer';
    const num=document.createElement('div'); num.className='num'; num.textContent='Página '+i+' de '+pdfJsDoc.numPages;
    el.append(canvas,layer,num); pagesEl.appendChild(el);
    pageInfos.push({page:p, prevPage:null, vp, w:vp.width, h:vp.height, el, layer, canvas, rendered:0, task:null, textItems:null});
    layer.addEventListener('pointerdown',ev=>onLayerDown(ev,i-1));
  }
  layoutPages();
}
function layoutPages(){
  $('#zoomLbl').textContent=Math.round(zoom*100)+'%';
  pageInfos.forEach(pi=>{ pi.el.style.width=(pi.w*zoom)+'px'; pi.el.style.height=(pi.h*zoom)+'px'; pi.rendered=0; });
  renderVisible(); renderElements(); if(tool==='erase') showTextBoxes();
}
let renderTimer=null;
function renderVisible(){
  clearTimeout(renderTimer);
  renderTimer=setTimeout(()=>{
    const vr=viewer.getBoundingClientRect();
    pageInfos.forEach(pi=>{ const r=pi.el.getBoundingClientRect();
      if(r.bottom>vr.top-800 && r.top<vr.bottom+800 && pi.rendered!==renderKey(pi)) renderPage(pi); });
  },60);
}
function renderKey(pi){ return zoom+'|'+(pi.prevPage?preview.version:0); }
async function renderPage(pi){
  const key=renderKey(pi); pi.rendered=key;
  const dpr=Math.min(window.devicePixelRatio||1,2.5);
  const src=pi.prevPage||pi.page;
  const vp=src.getViewport({scale:zoom*dpr});
  const c=document.createElement('canvas'); c.width=Math.floor(vp.width); c.height=Math.floor(vp.height);
  try{
    if(pi.task) pi.task.cancel();
    pi.task=src.render({canvasContext:c.getContext('2d'), viewport:vp});
    await pi.task.promise; pi.task=null;
    if(pi.rendered!==key) return;
    pi.canvas.replaceWith(c); pi.canvas=c;
  }catch(e){ if(e && e.name!=='RenderingCancelledException') console.error(e); }
}
viewer.addEventListener('scroll',renderVisible);
window.addEventListener('resize',renderVisible);
function setZoom(z){
  z=Math.max(.4,Math.min(3,Math.round(z*100)/100)); if(z===zoom||!pageInfos.length){ zoom=z; return; }
  const sc=viewer.scrollTop/(viewer.scrollHeight||1);
  zoom=z; layoutPages(); viewer.scrollTop=sc*viewer.scrollHeight;
}

// ---------- erase preview (re-render pages with the text really removed) ----------
let previewTimer=null;
function eraseAreas(){
  const out=[];
  for(const e of elements){
    if(e.type==='erase') out.push({id:e.id, page:e.page, x:e.x, y:e.y, w:e.w, h:e.h, mode:e.mode||'text'});
    else if(e.replaces) out.push({id:e.id, page:e.page, x:e.replaces.x, y:e.replaces.y, w:e.replaces.w, h:e.replaces.h, mode:e.replaces.mode||'text'});
  }
  return out;
}
function areaRect(e){
  const vp=pageInfos[e.page].vp;
  const a=vp.convertToPdfPoint(e.x,e.y), b=vp.convertToPdfPoint(e.x+e.w,e.y+e.h);
  return {x0:Math.min(a[0],b[0]), y0:Math.min(a[1],b[1]), x1:Math.max(a[0],b[0]), y1:Math.max(a[1],b[1])};
}
function schedulePreview(){ clearTimeout(previewTimer); previewTimer=setTimeout(runPreview,250); }
async function runPreview(){
  const areas=eraseAreas();
  const sig=JSON.stringify(areas.map(e=>[e.page,Math.round(e.x),Math.round(e.y),Math.round(e.w),Math.round(e.h),e.mode]));
  if(sig===preview.sig) return;
  const ver=++preview.version; preview.sig=sig;
  if(!areas.length){
    preview.doc=null; preview.stats={removed:0,by:{},gfx:{},graphics:0};
    pageInfos.forEach(pi=>{ if(pi.prevPage){ pi.prevPage=null; pi.rendered=0; } });
    renderVisible(); renderProps(); return;
  }
  try{
    const doc=await loadPdfLib(pdfBytes);
    const stats=Erase.apply(doc, areas.map(e=>({page:e.page, rect:areaRect(e), id:e.id, mode:e.mode})));
    const bytes=await doc.save({useObjectStreams:false});
    if(ver!==preview.version) return;
    const pdoc=await loadPdfJs(bytes);
    if(ver!==preview.version){ pdoc.destroy(); return; }
    if(preview.doc) preview.doc.destroy();
    preview.doc=pdoc; preview.stats=stats;
    const pagesWith=new Set(areas.map(e=>e.page));
    for(let i=0;i<pageInfos.length;i++){
      const pi=pageInfos[i];
      if(pagesWith.has(i) || pi.prevPage){ pi.prevPage = pagesWith.has(i) ? await pdoc.getPage(i+1) : null; pi.rendered=0; }
    }
    renderVisible(); renderProps();
  }catch(err){ console.error(err); toast('Não consegui pré-visualizar a remoção: '+friendlyError(err), true); }
}

// ---------- text boxes for click-to-erase ----------
async function ensureTextItems(pi){
  if(pi.textItems) return pi.textItems;
  const tc=await pi.page.getTextContent();
  const items=[];
  for(const it of tc.items){
    if(!it.str || !it.str.trim()) continue;
    const tx=pdfjsLib.Util.transform(pi.vp.transform, it.transform);
    const fh=Math.hypot(tx[2],tx[3]);
    const angle=Math.atan2(tx[1],tx[0]);
    if(Math.abs(angle)>0.01) { // rotated text: approximate with bounding box of the run
      const w=it.width*pi.vp.scale, cos=Math.cos(angle), sin=Math.sin(angle);
      const pts=[[0,0],[w,0],[0,-fh],[w,-fh]].map(([x,y])=>[tx[4]+x*cos-y*sin, tx[5]+x*sin+y*cos]);
      const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
      items.push({x:Math.min(...xs), y:Math.min(...ys), w:Math.max(...xs)-Math.min(...xs), h:Math.max(...ys)-Math.min(...ys), str:it.str, rot:true, fh, base:tx[5], fontName:it.fontName});
    } else {
      items.push({x:tx[4], y:tx[5]-fh*0.85, w:it.width*pi.vp.scale, h:fh*1.05, str:it.str, fh, base:tx[5], fontName:it.fontName, family:(tc.styles[it.fontName]||{}).fontFamily});
    }
  }
  return (pi.textItems=items);
}
async function showTextBoxes(){
  hideTextBoxes();
  for(const pi of pageInfos){
    const items=await ensureTextItems(pi);
    if(tool!=='erase' && tool!=='edittext') return;
    const frag=document.createDocumentFragment();
    items.forEach((it,idx)=>{
      const d=document.createElement('div'); d.className='tbox'+(tool==='edittext'?' edit':''); d.dataset.idx=idx; d.title=(tool==='edittext'?'Clique para editar: ':'Clique para apagar: ')+it.str.slice(0,80);
      d.style.left=(it.x*zoom)+'px'; d.style.top=(it.y*zoom)+'px'; d.style.width=(it.w*zoom)+'px'; d.style.height=(it.h*zoom)+'px';
      frag.appendChild(d);
    });
    pi.layer.prepend(frag);
  }
}
function hideTextBoxes(){ $$('.tbox').forEach(n=>n.remove()); }

// ---------- tools ----------
$$('.tool').forEach(b=>b.addEventListener('click',async()=>{
  const t=b.dataset.tool;
  if(t==='sign'||t==='image'){
    if(!pdfJsDoc){ toast('Abra um PDF primeiro.'); return; }
    if(tool==='image' && toolBtn===t){ setTool(null); return; }
    const img = t==='sign' ? await Sign.open() : await Sign.pickImage();
    if(!img) return;
    pendingImage=img; setTool('image',t);
    toast(t==='sign'?'Clique na página onde a assinatura deve ficar.':'Clique na página para posicionar a imagem.');
    return;
  }
  setTool(tool===t?null:t);
}));
function setTool(t,btn){
  if(t && !pdfJsDoc){ toast('Abra um PDF primeiro.'); return; }
  tool=t; toolBtn=t?(btn||t):null;
  $$('.tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===toolBtn));
  viewer.classList.toggle('placing',!!t);
  hideTextBoxes();
  const msg={erase:'Clique num texto para apagá-lo, ou arraste para marcar uma área.', edittext:'Clique numa linha de texto do PDF para editá-la.',
    eraseall:'Arraste sobre a área: tudo dentro dela (texto, linhas, fundos e imagens) será apagado. Use para excluir tabelas.',
    tableconv:'Arraste cobrindo a tabela inteira, incluindo as bordas, para torná-la editável.', table:'Clique na página onde a tabela deve começar.'}[t];
  if(t==='erase'||t==='edittext') showTextBoxes();
  if(msg) toast(msg);
}
function finishTool(){ if(!$('#stickyTool').checked) setTool(null); }

function onLayerDown(ev,pageIndex){
  if(ev.target.closest('.el')) return;
  if(!tool){ select(null); return; }
  ev.preventDefault();
  const pi=pageInfos[pageIndex]; const r=pi.layer.getBoundingClientRect();
  const x=(ev.clientX-r.left)/zoom, y=(ev.clientY-r.top)/zoom;
  if(tool==='erase'||tool==='eraseall'||tool==='tableconv'){ startRubber(ev,pi,pageIndex,x,y); return; }
  if(tool==='edittext'){ const tb=ev.target.closest('.tbox'); if(tb) editExisting(pageIndex,+tb.dataset.idx); else toast('Clique sobre um texto do PDF para editá-lo.'); return; }
  addElement(tool,pageIndex,x,y);
  finishTool();
}
function startRubber(ev,pi,pageIndex,x0,y0){
  const tb=ev.target.closest('.tbox');
  const rb=document.createElement('div'); rb.className='rubber'; pi.layer.appendChild(rb);
  const r=pi.layer.getBoundingClientRect(); let x1=x0,y1=y0;
  const move=m=>{ x1=Math.max(0,Math.min(pi.w,(m.clientX-r.left)/zoom)); y1=Math.max(0,Math.min(pi.h,(m.clientY-r.top)/zoom));
    rb.style.left=Math.min(x0,x1)*zoom+'px'; rb.style.top=Math.min(y0,y1)*zoom+'px'; rb.style.width=Math.abs(x1-x0)*zoom+'px'; rb.style.height=Math.abs(y1-y0)*zoom+'px'; };
  const up=()=>{
    window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); rb.remove();
    const w=Math.abs(x1-x0), h=Math.abs(y1-y0), mode=tool==='eraseall'?'all':'text';
    if(tool==='tableconv'){ if(w>8&&h>8) convertTable(pageIndex,{x:Math.min(x0,x1),y:Math.min(y0,y1),w,h}); else toast('Arraste para cobrir a tabela inteira.'); return; }
    if(w>4 && h>4) addErase(pageIndex, Math.min(x0,x1), Math.min(y0,y1), w, h, mode);
    else if(tb && pi.textItems){ const it=pi.textItems[+tb.dataset.idx]; addErase(pageIndex, it.x-1, it.y-1, it.w+2, it.h+2, mode); }
    else return;
    finishTool();
  };
  window.addEventListener('pointermove',move); window.addEventListener('pointerup',up);
}
function addErase(page,x,y,w,h,mode){
  snapshot();
  const e={id:nextId++, type:'erase', page, x, y, w, h, mode:mode||'text', cover:false, coverColor:'#ffffff'};
  elements.push(e); selectedId=e.id; renderElements(); renderProps(); schedulePreview();
}

function addElement(type,page,x,y){
  snapshot();
  const T=TYPES[type], pi=pageInfos[page];
  const e={id:nextId++, type, page};
  if(type==='text'){
    Object.assign(e,{text:''}, lastText);
    e.x=x; e.y=y-e.size*0.6;
  } else if(type==='table'){
    Object.assign(e,{colW:[90,90,90], rowH:[18,18,18], cells:[['','',''],['','',''],['','','']], font:lastText.font, size:10, color:'#000000',
      border:'#000000', bw:0.75, header:true, headerFill:'#e8eef5', align:'left'});
    e.x=x; e.y=y; e.w=270; e.h=54;
    actCell={id:e.id,r:0,c:0};
  } else if(type==='image'){
    if(!pendingImage){ history.pop(); return; }
    e.src=pendingImage.src; e.ratio=pendingImage.ratio;
    e.w=Math.min(pendingImage.defaultW, pi.w*0.8); e.h=e.w/e.ratio;
    if(e.h>pi.h*0.8){ e.h=pi.h*0.8; e.w=e.h*e.ratio; }
    e.x=x-e.w/2; e.y=y-e.h/2;
  } else {
    e.w=T.w; e.h=T.h; e.x=x-e.w/2; e.y=y-e.h/2;
    if(T.kind==='symbol') e.color=lastText.color==='#000000'?'#000000':lastText.color;
    if(T.kind==='field'){
      e.required=false; e.border=['radio','checkbox','signature'].includes(type);
      if(type==='radio'){
        const lastRadio=[...elements].reverse().find(o=>o.type==='radio');
        e.name=lastRadio?lastRadio.name:uniqueName('opcao');
        const same=elements.filter(o=>o.type==='radio'&&o.name===e.name).length;
        e.value='Opção '+(same+1); e.selected=false;
      } else e.name=uniqueName(T.prefix);
      if(type==='ftext'||type==='fmulti'){ e.value=''; e.fontSize=type==='fmulti'?10:0; }
      if(type==='dropdown'){ e.options=['Opção 1','Opção 2','Opção 3']; e.value=''; e.fontSize=0; }
      if(type==='checkbox') e.checked=false;
    }
  }
  if(e.w){ e.x=Math.max(0,Math.min(pi.w-e.w,e.x)); e.y=Math.max(0,Math.min(pi.h-e.h,e.y)); }
  else { e.x=Math.max(0,Math.min(pi.w-10,e.x)); e.y=Math.max(0,Math.min(pi.h-e.size,e.y)); }
  elements.push(e); selectedId=e.id; renderElements(); renderProps();
  if(type==='text') startEditing(e.id);
}

// ---------- element rendering ----------
const SYM_SVG={
  cross:c=>`<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M12 12 88 88M88 12 12 88" stroke="${c}" stroke-width="13" stroke-linecap="round" fill="none"/></svg>`,
  check:c=>`<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M10 55 38 83 92 18" stroke="${c}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
  dot:c=>`<svg viewBox="0 0 100 100" preserveAspectRatio="none"><ellipse cx="50" cy="50" rx="50" ry="50" fill="${c}"/></svg>`
};
const FIELD_CLASS={ftext:'',fmulti:'multiline',dropdown:'dropdown',radio:'radio',checkbox:'checkbox',signature:'signature'};
function renderElements(){
  pageInfos.forEach(pi=>{ [...pi.layer.querySelectorAll('.el')].forEach(n=>{ if(!n.classList.contains('editing')) n.remove(); }); });
  elements.forEach(e=>{
    const pi=pageInfos[e.page]; if(!pi) return;
    let n=pi.layer.querySelector(`.el[data-id="${e.id}"]`);
    if(n && n.classList.contains('editing')){ positionNode(n,e); n.classList.toggle('selected',e.id===selectedId); return; }
    n=document.createElement('div'); n.dataset.id=e.id;
    const k=kind(e);
    n.className='el '+k+(k==='field'?' '+FIELD_CLASS[e.type]:'');
    fillNode(n,e); positionNode(n,e);
    if(e.id===selectedId) n.classList.add('selected');
    if(k!=='text'){ const h=document.createElement('div'); h.className='handle'; n.appendChild(h); }
    n.addEventListener('pointerdown',ev=>onElDown(ev,e.id));
    if(k==='text') n.addEventListener('dblclick',()=>startEditing(e.id));
    if((k==='text'||k==='table') && !Fonts.isLoaded(e.font)) Fonts.ensure(e.font).then(()=>renderElements());
    pi.layer.appendChild(n);
  });
  updateCount();
}
function fillNode(n,e){
  const k=kind(e);
  if(k==='text'){ n.textContent=e.text; n.classList.toggle('repl',!!e.replaces); }
  else if(k==='table'){ fillTable(n,e); }
  else if(k==='symbol'){ n.innerHTML=SYM_SVG[e.type](e.color); }
  else if(k==='image'){ const im=new Image(); im.src=e.src; im.draggable=false; im.alt=''; n.innerHTML=''; n.appendChild(im); }
  else if(k==='erase'){
    n.classList.toggle('covered',!!e.cover); n.style.setProperty('--cover',e.coverColor);
    const c=preview.stats.by[e.id], g=(preview.stats.gfx||{})[e.id]||0;
    n.classList.toggle('all',e.mode==='all');
    const label = e.mode==='all' ? (c===undefined?'Apagar tudo…':`Apagar tudo · ${c||0} caract. · ${g} gráf.`) : (c===undefined?'Apagar…':c? 'Apagar · '+c+' caract.':'Sem texto aqui'+(e.cover?' · coberto':''));
    n.innerHTML=`<span class="tag">${label}</span>`;
  }
  else {
    const fs=Math.max(7,(e.fontSize||Math.min(12,e.h*0.62)))*zoom;
    n.style.fontSize=fs+'px';
    if(e.type==='ftext'||e.type==='fmulti') n.innerHTML=`<span class="lbl">${esc(e.value||e.name)}</span>`;
    else if(e.type==='dropdown') n.innerHTML=`<span class="lbl">${esc(e.value||e.name)}</span><span class="caret">▾</span>`;
    else if(e.type==='radio') n.innerHTML=e.selected?'<span class="dot"></span>':'';
    else if(e.type==='checkbox') n.innerHTML=e.checked?'<svg viewBox="0 0 24 24" fill="none" stroke="#28414a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7"/></svg>':'';
    else if(e.type==='signature'){ n.style.fontSize=Math.min(11,e.h*0.3)*zoom+'px'; n.innerHTML=`<span class="lbl">✍ Assinatura</span><span class="lbl" style="opacity:.6">${esc(e.name)}</span>`; }
  }
}
function positionNode(n,e){
  n.style.left=(e.x*zoom)+'px'; n.style.top=(e.y*zoom)+'px';
  if(kind(e)==='text'){
    n.style.fontFamily=Fonts.info(e.font).css;
    n.style.fontSize=(e.size*zoom)+'px'; n.style.color=e.color; n.style.fontWeight=e.bold?'700':'400'; n.style.fontStyle=e.italic?'italic':'normal';
    n.style.textDecoration=[e.underline?'underline':'',e.strike?'line-through':''].join(' ').trim()||'none';
  } else if(kind(e)==='table'){ n.style.width=(e.w*zoom)+'px'; n.style.height=(e.h*zoom)+'px'; }
  else { n.style.width=(e.w*zoom)+'px'; n.style.height=(e.h*zoom)+'px'; }
}
function updateCount(){ const c=$('#elcount'); if(c) c.textContent=countText(); }
function countText(){ const n=elements.length; return n? n+(n===1?' item adicionado':' itens adicionados') : 'Nenhum item adicionado ainda'; }

// ---------- select / drag / resize ----------
function select(id){
  if(editingId && editingId!==id) stopEditing();
  selectedId=id;
  $$('.el').forEach(n=>n.classList.toggle('selected',+n.dataset.id===id));
  renderProps();
}
function onElDown(ev,id){
  const node=ev.currentTarget;
  if(node.classList.contains('editing')) return;
  ev.preventDefault(); ev.stopPropagation();
  if(selectedId!==id) select(id);
  const e=getEl(id), pi=pageInfos[e.page];
  if(kind(e)==='table'){
    if(ev.target.closest('.tcell.editing')) return;
    const grip=ev.target.closest('.colgrip,.rowgrip'); if(grip){ gripDrag(ev,e,node,grip); return; }
    const cell=ev.target.closest('.tcell');
    if(cell){ const r=+cell.dataset.r, c=+cell.dataset.c, now=Date.now();
      if(lastCellDown && lastCellDown.id===e.id && lastCellDown.r===r && lastCellDown.c===c && now-lastCellDown.t<500){ lastCellDown=null; ev.preventDefault(); ev.stopPropagation(); editCell(e.id,r,c); return; }
      lastCellDown={id:e.id,r,c,t:now}; actCell={id:e.id,r,c}; }
  }
  const resizing=ev.target.classList.contains('handle');
  const sx=ev.clientX, sy=ev.clientY, ox=e.x, oy=e.y, ow=e.w, oh=e.h, oCol=e.colW&&e.colW.slice(), oRow=e.rowH&&e.rowH.slice();
  let moved=false;
  node.setPointerCapture(ev.pointerId);
  const move=m=>{
    const dx=(m.clientX-sx)/zoom, dy=(m.clientY-sy)/zoom;
    if(!moved && Math.abs(dx)+Math.abs(dy)<2/zoom) return;
    if(!moved){ snapshot(); moved=true; }
    if(resizing){
      const keepSquare=kind(e)==='symbol'||e.type==='radio'||e.type==='checkbox';
      let w=Math.max(5,ow+dx), h=Math.max(5,oh+dy);
      if(keepSquare){ const s=Math.max(w,h); w=h=s; }
      if(kind(e)==='table'){ const fx=Math.min(Math.max(30,ow+dx),pi.w-e.x)/ow, fy=Math.max(10,oh+dy)/oh; e.colW=oCol.map(v=>v*fx); e.rowH=oRow.map(v=>Math.max(6,v*fy)); fillTable(node,e); node.appendChild(Object.assign(document.createElement('div'),{className:'handle'})); }
      else if(kind(e)==='image'){ w=Math.max(8,Math.max(w,h*e.ratio)); w=Math.min(w,pi.w-e.x,(pi.h-e.y)*e.ratio); e.w=w; e.h=w/e.ratio; }
      else { e.w=Math.min(w,pi.w-e.x); e.h=Math.min(h,pi.h-e.y); }
      if(keepSquare){ const s=Math.min(e.w,e.h); e.w=e.h=s; }
      if(kind(e)==='field'){ fillNode(node,e); node.appendChild(Object.assign(document.createElement('div'),{className:'handle'})); }
    } else {
      const bw=e.w||node.offsetWidth/zoom, bh=e.h||node.offsetHeight/zoom;
      e.x=Math.max(0,Math.min(pi.w-bw,ox+dx)); e.y=Math.max(0,Math.min(pi.h-bh,oy+dy));
    }
    positionNode(node,e);
  };
  const up=()=>{ node.removeEventListener('pointermove',move); node.removeEventListener('pointerup',up); node.removeEventListener('pointercancel',up);
    if(moved){ renderProps(); if(e.type==='erase') schedulePreview(); }
    else if(kind(e)==='table'){ fillTable(node,e); node.appendChild(Object.assign(document.createElement('div'),{className:'handle'})); node.classList.add('selected'); renderProps(); } };
  node.addEventListener('pointermove',move); node.addEventListener('pointerup',up); node.addEventListener('pointercancel',up);
}

// ---------- editing existing PDF text ----------
function guessFont(pi, it){
  let name='';
  try{ if(it.fontName && pi.page.commonObjs.has(it.fontName)){ const f=pi.page.commonObjs.get(it.fontName); name=((f&&f.name)||'')+' '+((f&&f.loadedName)||''); } }catch(_){}
  const n=name.toLowerCase().replace(/^[a-z]{6}\+/,''), fam=(it.family||'').toLowerCase();
  const bold=/bold|black|heavy|semibold|demi/.test(n), italic=/italic|oblique/.test(n);
  let key='emb:Arial';
  if(/calibri|carlito/.test(n)) key='emb:Calibri';
  else if(/cambria|caladea/.test(n)) key='emb:Cambria';
  else if(/courier|mono|consol/.test(n) || fam==='monospace') key='emb:Courier';
  else if(/dejavusans|verdana|tahoma/.test(n)) key='emb:DejaVu';
  else if(/times|georgia|garamond|palatino|antiqua|dejavuserif|liberationserif|serif/.test(n.replace(/sans-?serif/g,'')) || fam==='serif') key='emb:Times';
  return {key, bold:bold&&Fonts.hasVariant(key,true,false), italic:italic&&Fonts.hasVariant(key,bold,true)};
}
function canvasCtx(pi){ const c=pi.canvas; if(!c || !pi.rendered || !c.width) return null; return {g:c.getContext('2d',{willReadFrequently:true}), s:c.width/pi.w}; }
function toHexColor(r,g,b){ return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join(''); }
function sampleColor(pi,box){
  const cc=canvasCtx(pi); if(!cc) return '#000000';
  const x=Math.max(0,Math.floor(box.x*cc.s)), y=Math.max(0,Math.floor(box.y*cc.s)), w=Math.max(1,Math.ceil(box.w*cc.s)), h=Math.max(1,Math.ceil(box.h*cc.s));
  try{ const d=cc.g.getImageData(x,y,w,h).data; let best=765, col=[0,0,0];
    for(let i=0;i<d.length;i+=4){ const l=d[i]+d[i+1]+d[i+2]; if(l<best){ best=l; col=[d[i],d[i+1],d[i+2]]; } }
    if(best>600) return '#000000';
    if(Math.max(...col)-Math.min(...col)<40 && best<200) return '#000000';
    return toHexColor(...col);
  }catch(_){ return '#000000'; }
}
function sampleBg(pi,x,y){
  const cc=canvasCtx(pi); if(!cc) return null;
  try{ const d=cc.g.getImageData(Math.floor(x*cc.s),Math.floor(y*cc.s),1,1).data; if(d[0]+d[1]+d[2]>735) return null; return toHexColor(d[0],d[1],d[2]); }catch(_){ return null; }
}
function lineGroups(list){ // items -> lines (sorted top-down, each sorted left-right)
  const sorted=[...list].sort((a,b)=>a.base-b.base); const lines=[];
  for(const it of sorted){ const ln=lines.find(l=>Math.abs(l.base-it.base)<it.fh*0.5); if(ln){ ln.items.push(it); } else lines.push({base:it.base, items:[it]}); }
  lines.forEach(l=>l.items.sort((a,b)=>a.x-b.x));
  return lines;
}
function joinLine(items){ let s='', prev=null; for(const o of items){ if(prev){ const gap=o.x-(prev.x+prev.w); if(gap>o.fh*0.15 && !s.endsWith(' ') && !o.str.startsWith(' ')) s+=' '; } s+=o.str; prev=o; } return s; }
async function editExisting(pageIndex, idx){
  const pi=pageInfos[pageIndex]; const items=pi.textItems; const it=items&&items[idx]; if(!it) return;
  if(it.rot){ toast('Texto inclinado ainda não pode ser editado; use "Apagar texto" e escreva por cima.',true); return; }
  const line=[it];
  const same=o=>!o.rot && Math.abs(o.base-it.base)<it.fh*0.4 && Math.abs(o.fh-it.fh)<it.fh*0.35;
  let grew=true;
  while(grew){ grew=false; const minX=Math.min(...line.map(l=>l.x)), maxX=Math.max(...line.map(l=>l.x+l.w));
    items.forEach(o=>{ if(line.includes(o)||!same(o)) return; if(o.x<=maxX+it.fh*1.2 && o.x+o.w>=minX-it.fh*1.2){ line.push(o); grew=true; } }); }
  line.sort((a,b)=>a.x-b.x);
  const text=joinLine(line).replace(/\s+$/,'');
  const minX=Math.min(...line.map(l=>l.x)), maxX=Math.max(...line.map(l=>l.x+l.w)), minY=Math.min(...line.map(l=>l.y)), maxY=Math.max(...line.map(l=>l.y+l.h));
  const box={x:minX-1, y:minY-1, w:maxX-minX+2, h:maxY-minY+2};
  if(elements.some(e=>e.replaces&&e.page===pageIndex&&Math.abs(e.replaces.x-box.x)<1&&Math.abs(e.replaces.y-box.y)<1)){ toast('Essa linha já está sendo editada.'); return; }
  const f=guessFont(pi,it);
  { // style by majority of characters in the line
    let wb=0, wi=0, tot=0; line.forEach(o=>{ const g=guessFont(pi,o), n=o.str.trim().length; tot+=n; if(g.bold) wb+=n; if(g.italic) wi+=n; });
    f.bold=wb>tot/2 && Fonts.hasVariant(f.key,true,false); f.italic=wi>tot/2 && Fonts.hasVariant(f.key,f.bold,true); }
  await Fonts.ensure(f.key);
  snapshot();
  const size=Math.round(it.fh*10)/10;
  const e={id:nextId++, type:'text', page:pageIndex, text, font:f.key, size, bold:f.bold, italic:f.italic, underline:false, strike:false,
    color:sampleColor(pi,box), replaces:{...box, mode:'text'}};
  e.x=minX; e.y=it.base-Fonts.baseline(f.key,f.bold,f.italic)*size;
  elements.push(e); selectedId=e.id; renderElements(); renderProps(); schedulePreview(); startEditing(e.id);
}

// ---------- tables ----------
const TPAD=3;
let actCell={id:null,r:0,c:0}, editingCell=null, lastCellDown=null;
function tableLayout(e){
  const cols=[]; let x=0; e.colW.forEach(w=>{ cols.push({x,w}); x+=w; });
  const rows=[], lines=[]; let y=0;
  e.rowH.forEach((mh,r)=>{
    const bold=e.header&&r===0; const rl=[]; let need=mh;
    e.colW.forEach((w,c)=>{ const L=wrapText(e.cells[r][c]||'', Math.max(4,w-2*TPAD), e.font, e.size, bold, false); rl.push(L); need=Math.max(need, L.length*1.2*e.size+2*TPAD); });
    rows.push({y,h:need}); lines.push(rl); y+=need;
  });
  return {cols,rows,lines,W:x,H:y};
}
function fillTable(n,e){
  const L=tableLayout(e); e.w=L.W; e.h=L.H; const z=zoom;
  let h='';
  L.rows.forEach((row,r)=>L.cols.forEach((col,c)=>{
    const hdr=e.header&&r===0, fill=hdr&&e.headerFill?`background:${e.headerFill};`:'';
    const act=(actCell.id===e.id&&actCell.r===r&&actCell.c===c&&selectedId===e.id)?' act':'';
    const lines=L.lines[r][c].map(t=>`<div class="tl" style="height:${1.2*e.size*z}px;text-align:${e.align}">${esc(t)||'&#8203;'}</div>`).join('');
    h+=`<div class="tcell${act}" data-r="${r}" data-c="${c}" style="left:${col.x*z}px;top:${row.y*z}px;width:${col.w*z}px;height:${row.h*z}px;${fill}padding:${TPAD*z}px;font-weight:${hdr?700:400}">${lines}</div>`;
  }));
  if(e.bw>0){
    const xs=[0,...L.cols.map(c=>c.x+c.w)], ys=[0,...L.rows.map(r=>r.y+r.h)];
    let s=`<svg class="tgrid" width="${L.W*z}" height="${L.H*z}" style="overflow:visible">`;
    xs.forEach(x=>s+=`<line x1="${x*z}" y1="0" x2="${x*z}" y2="${L.H*z}"/>`); ys.forEach(y=>s+=`<line x1="0" y1="${y*z}" x2="${L.W*z}" y2="${y*z}"/>`);
    h+=s+'</svg>';
  }
  n.innerHTML=h; n.style.fontFamily=Fonts.info(e.font).css; n.style.fontSize=e.size*z+'px'; n.style.color=e.color; n.style.lineHeight=(1.2*e.size*z)+'px';
  n.style.setProperty('--tb',e.border); n.style.setProperty('--tbw',Math.max(1,e.bw*z)+'px');
  if(selectedId===e.id){
    L.cols.slice(0,-1).forEach((c,i)=>{ const g=document.createElement('div'); g.className='colgrip'; g.dataset.i=i; g.style.left=((c.x+c.w)*z-3)+'px'; g.style.height=L.H*z+'px'; n.appendChild(g); });
    L.rows.forEach((r,i)=>{ const g=document.createElement('div'); g.className='rowgrip'; g.dataset.i=i; g.style.top=((r.y+r.h)*z-3)+'px'; g.style.width=L.W*z+'px'; n.appendChild(g); });
  }
  n.style.width=L.W*z+'px'; n.style.height=L.H*z+'px';
}
function gripDrag(ev,e,node,grip){
  ev.preventDefault(); ev.stopPropagation(); node.setPointerCapture(ev.pointerId);
  const i=+grip.dataset.i, col=grip.classList.contains('colgrip'), sx=ev.clientX, sy=ev.clientY;
  const L=tableLayout(e); const o1=col?e.colW[i]:L.rows[i].h, o2=col?e.colW[i+1]:0; let moved=false;
  const move=m=>{ const d=((col?m.clientX-sx:m.clientY-sy))/zoom; if(!moved){ snapshot(); moved=true; }
    if(col){ const dd=Math.max(12-o1,Math.min(o2-12,d)); e.colW[i]=o1+dd; e.colW[i+1]=o2-dd; }
    else e.rowH[i]=Math.max(6,o1+d);
    fillTable(node,e); node.appendChild(Object.assign(document.createElement('div'),{className:'handle'})); };
  const up=()=>{ node.removeEventListener('pointermove',move); node.removeEventListener('pointerup',up); if(moved) renderProps(); };
  node.addEventListener('pointermove',move); node.addEventListener('pointerup',up);
}
function editCell(id,r,c,selAll){
  const e=getEl(id); if(!e) return;
  if(editingId) stopEditing();
  selectedId=id; actCell={id,r,c}; renderElements(); renderProps();
  const n=document.querySelector(`.el[data-id="${id}"]`); const cell=n&&n.querySelector(`.tcell[data-r="${r}"][data-c="${c}"]`); if(!cell) return;
  snapshot(); editingCell={id,r,c};
  cell.classList.add('editing'); cell.textContent=e.cells[r][c]||'';
  try{ cell.contentEditable='plaintext-only'; }catch(_){} if(cell.contentEditable!=='plaintext-only') cell.contentEditable='true';
  cell.focus(); const rg=document.createRange(); rg.selectNodeContents(cell); if(!selAll) rg.collapse(false); const s=getSelection(); s.removeAllRanges(); s.addRange(rg);
  cell.oninput=()=>{ e.cells[r][c]=cell.innerText.replace(/\n$/,''); const ta=$('#t_cell'); if(ta) ta.value=e.cells[r][c]; };
  cell.onkeydown=k=>{
    if(k.key==='Escape'){ k.preventDefault(); cell.blur(); }
    if(k.key==='Tab'){ k.preventDefault(); const tot=e.rowH.length*e.colW.length; let idx=r*e.colW.length+c+(k.shiftKey?-1:1);
      if(idx>=tot){ e.rowH.push(e.rowH[e.rowH.length-1]); e.cells.push(e.colW.map(()=>'')); }
      idx=Math.max(0,idx); cell.onblur=null; finishCell(); editCell(id,Math.floor(idx/e.colW.length),idx%e.colW.length,true); }
  };
  cell.onblur=()=>setTimeout(()=>{ if(editingCell&&editingCell.id===id&&editingCell.r===r&&editingCell.c===c) { finishCell(); renderElements(); renderProps(); } },0);
}
function finishCell(){ editingCell=null; }
function bindTableProps(e,snap,refresh){
  const on=(id,ev,fn)=>{ const n=$('#'+id); if(n) n.addEventListener(ev,fn); };
  const cur=()=>{ const a=actCell.id===e.id?actCell:{r:0,c:0}; return {r:Math.min(a.r,e.rowH.length-1), c:Math.min(a.c,e.colW.length-1)}; };
  const done=()=>{ renderElements(); renderProps(); };
  on('t_cell','input',ev=>{ snap(); const {r,c}=cur(); e.cells[r][c]=ev.target.value; refresh(); });
  on('t_rowAbove','click',()=>{ snapshot(); const {r}=cur(); e.rowH.splice(r,0,e.rowH[r]); e.cells.splice(r,0,e.colW.map(()=>'')); actCell={id:e.id,r,c:cur().c}; done(); });
  on('t_rowBelow','click',()=>{ snapshot(); const {r}=cur(); e.rowH.splice(r+1,0,e.rowH[r]); e.cells.splice(r+1,0,e.colW.map(()=>'')); actCell={id:e.id,r:r+1,c:cur().c}; done(); });
  on('t_colLeft','click',()=>{ snapshot(); const {c}=cur(); const w=Math.max(30,e.colW[c]/2); e.colW.splice(c,0,w); e.cells.forEach(row=>row.splice(c,0,'')); actCell={id:e.id,r:cur().r,c}; done(); });
  on('t_colRight','click',()=>{ snapshot(); const {c}=cur(); const w=Math.max(30,e.colW[c]/2); e.colW.splice(c+1,0,w); e.cells.forEach(row=>row.splice(c+1,0,'')); actCell={id:e.id,r:cur().r,c:c+1}; done(); });
  on('t_rowDel','click',()=>{ if(e.rowH.length<2){ toast('A tabela precisa de pelo menos uma linha.'); return; } snapshot(); const {r}=cur(); e.rowH.splice(r,1); e.cells.splice(r,1); actCell={id:e.id,r:Math.max(0,r-1),c:cur().c}; done(); });
  on('t_colDel','click',()=>{ if(e.colW.length<2){ toast('A tabela precisa de pelo menos uma coluna.'); return; } snapshot(); const {c}=cur(); e.colW.splice(c,1); e.cells.forEach(row=>row.splice(c,1)); actCell={id:e.id,r:cur().r,c:Math.max(0,c-1)}; done(); });
  on('t_colW','input',ev=>{ const v=+ev.target.value; if(v>=12){ snap(); e.colW[cur().c]=v; refresh(); } });
  on('t_rowH','input',ev=>{ const v=+ev.target.value; if(v>=6){ snap(); e.rowH[cur().r]=v; refresh(); } });
  on('t_align','change',ev=>{ snap(); e.align=ev.target.value; refresh(); });
  on('t_bw','change',ev=>{ snap(); e.bw=+ev.target.value; refresh(); });
  on('t_border','input',ev=>{ snap(); e.border=ev.target.value; refresh(); });
  on('t_header','change',ev=>{ snap(); e.header=ev.target.checked; refresh(); renderProps(); });
  on('t_hfOn','change',ev=>{ snap(); e.headerFill=ev.target.checked?($('#t_hf').value||'#e8eef5'):null; refresh(); });
  on('t_hf','input',ev=>{ snap(); e.headerFill=ev.target.value; const cb=$('#t_hfOn'); if(cb) cb.checked=true; refresh(); });
}
async function drawTable(page,P,rot,e,doc,fontCache){
  await Fonts.ensure(e.font);
  const L=tableLayout(e);
  const feR=await embedFontFor(doc,fontCache,e.font,false,false);
  const feB=e.header?await embedFontFor(doc,fontCache,e.font,Fonts.hasVariant(e.font,true,false),false):feR;
  const poly=(x,y,w,h,color)=>{ const a=P(e.x+x,e.y+y),b=P(e.x+x+w,e.y+y),c=P(e.x+x+w,e.y+y+h),d=P(e.x+x,e.y+y+h);
    page.drawSvgPath(`M ${a.x} ${-a.y} L ${b.x} ${-b.y} L ${c.x} ${-c.y} L ${d.x} ${-d.y} Z`,{x:0,y:0,color}); };
  if(e.header && e.headerFill) poly(0,0,L.W,L.rows[0].h,hexToRgb(e.headerFill));
  L.rows.forEach((row,r)=>L.cols.forEach((col,c)=>{
    const hdr=e.header&&r===0, fe=hdr?feB:feR, bl=Fonts.baseline(e.font,hdr,false);
    L.lines[r][c].forEach((t,i)=>{
      const txt=cleanForFont(fe,t); if(!txt.trim()) return;
      const tw=measureText(t,e.font,e.size,hdr,false);
      let tx=col.x+TPAD; if(e.align==='center') tx=col.x+(col.w-tw)/2; else if(e.align==='right') tx=col.x+col.w-TPAD-tw;
      const o=P(e.x+tx, e.y+row.y+TPAD+(i*1.2+bl)*e.size);
      page.drawText(txt,{x:o.x,y:o.y,size:e.size,font:fe.font,color:hexToRgb(e.color),rotate:degrees(rot)});
    });
  }));
  if(e.bw>0){
    const col=hexToRgb(e.border), xs=[0,...L.cols.map(c=>c.x+c.w)], ys=[0,...L.rows.map(r=>r.y+r.h)];
    xs.forEach(x=>page.drawLine({start:P(e.x+x,e.y),end:P(e.x+x,e.y+L.H),thickness:e.bw,color:col,lineCap:2}));
    ys.forEach(y=>page.drawLine({start:P(e.x,e.y+y),end:P(e.x+L.W,e.y+y),thickness:e.bw,color:col,lineCap:2}));
  }
}
async function convertTable(pageIndex,R){
  const pi=pageInfos[pageIndex];
  busy(true,'Lendo a tabela…');
  try{
    if(!pi.segs){ const doc=await loadPdfLib(pdfBytes);
      pi.segs=Erase.segments(doc,pageIndex).map(s=>{ const a=pi.vp.convertToViewportPoint(s.x0,s.y0), b=pi.vp.convertToViewportPoint(s.x1,s.y1);
        return {x0:Math.min(a[0],b[0]),y0:Math.min(a[1],b[1]),x1:Math.max(a[0],b[0]),y1:Math.max(a[1],b[1])}; }); }
    const tol=4, inR=s=>s.x0>=R.x-tol&&s.x1<=R.x+R.w+tol&&s.y0>=R.y-tol&&s.y1<=R.y+R.h+tol;
    const V=pi.segs.filter(s=>inR(s)&&s.x1-s.x0<1.2&&s.y1-s.y0>4), H=pi.segs.filter(s=>inR(s)&&s.y1-s.y0<1.2&&s.x1-s.x0>4);
    const clus=vals=>{ vals.sort((a,b)=>a-b); const out=[]; for(const v of vals){ const c=out[out.length-1]; if(!c||v-c.last>4) out.push({sum:v,n:1,last:v}); else { c.sum+=v; c.n++; c.last=v; } } return out.map(c=>c.sum/c.n); };
    const xs=clus(V.map(s=>(s.x0+s.x1)/2)), ys=clus(H.map(s=>(s.y0+s.y1)/2));
    if(xs.length<2||ys.length<2) throw new Error('Não encontrei as linhas de uma tabela nessa área. Arraste cobrindo a tabela inteira, incluindo as bordas. (Tabelas sem bordas ainda não são reconhecidas.)');
    const x0=xs[0], x1=xs[xs.length-1], y0=ys[0], y1=ys[ys.length-1];
    const colW=xs.slice(1).map((x,i)=>x-xs[i]), rowH=ys.slice(1).map((y,i)=>y-ys[i]);
    const items=(await ensureTextItems(pi)).filter(it=>!it.rot && it.x+it.w/2>x0 && it.x+it.w/2<x1 && it.base-it.fh*0.3>y0 && it.base-it.fh*0.3<y1);
    const bucket=rowH.map(()=>colW.map(()=>[]));
    for(const it of items){ const cx=it.x+it.w/2, cy=it.base-it.fh*0.3;
      const c=xs.findIndex((x,i)=>i<xs.length-1&&cx>=x&&cx<xs[i+1]), r=ys.findIndex((y,i)=>i<ys.length-1&&cy>=y&&cy<ys[i+1]);
      if(c>=0&&r>=0) bucket[r][c].push(it); }
    const cells=bucket.map(row=>row.map(list=>lineGroups(list).map(l=>joinLine(l.items).trim()).join('\n')));
    const sizes=items.map(i=>i.fh).sort((a,b)=>a-b); const size=sizes.length?Math.round(sizes[Math.floor(sizes.length/2)]*2)/2:10;
    const f0=items[0]?guessFont(pi,items[0]):{key:'emb:Arial'};
    const hdrItems=bucket[0].flat(); const header=hdrItems.length>0 && hdrItems.every(it=>guessFont(pi,it).bold);
    const hf=sampleBg(pi,x0+2,y0+2);
    await Fonts.ensure(f0.key);
    snapshot();
    const e={id:nextId++, type:'table', page:pageIndex, x:x0, y:y0, colW, rowH:rowH.map(h=>Math.max(6,h)), cells, font:f0.key, size,
      color:'#000000', border:'#000000', bw:0.75, header, headerFill:hf, align:'left', replaces:{x:x0-2,y:y0-2,w:x1-x0+4,h:y1-y0+4,mode:'all'}};
    elements.push(e); selectedId=e.id; actCell={id:e.id,r:0,c:0}; renderElements(); renderProps(); schedulePreview();
    finishTool();
    toast(`Tabela com ${rowH.length} linha(s) e ${colW.length} coluna(s) pronta para editar.`);
  }catch(err){ console.error(err); toast(friendlyError(err),true); }
  finally{ busy(false); }
}

// ---------- text editing ----------
let editingId=null;
function startEditing(id){
  const n=document.querySelector(`.el[data-id="${id}"]`); if(!n) return;
  if(editingId && editingId!==id) stopEditing();
  editingId=id; selectedId=id;
  n.classList.add('editing','selected');
  try{ n.contentEditable='plaintext-only'; }catch(_){}
  if(n.contentEditable!=='plaintext-only') n.contentEditable='true';
  n.focus();
  const range=document.createRange(); range.selectNodeContents(n); range.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(range);
  n.oninput=()=>{ const e=getEl(id); if(e){ e.text=n.innerText.replace(/\n$/,''); const ta=$('#p_text'); if(ta) ta.value=e.text; } };
  n.onblur=()=>setTimeout(()=>{ if(editingId===id) stopEditing(); },0);
  n.onkeydown=k=>{ if(k.key==='Escape'){ k.preventDefault(); n.blur(); } };
  renderProps();
}
function stopEditing(){
  const id=editingId; editingId=null;
  const n=document.querySelector(`.el[data-id="${id}"]`), e=getEl(id);
  if(n){ n.classList.remove('editing'); n.contentEditable='false'; n.oninput=n.onblur=n.onkeydown=null; }
  if(e){ e.text=(n?n.innerText:e.text).replace(/\n$/,'');
    if(!e.text.trim()){
      if(e.replaces){ const r=e.replaces; Object.keys(e).forEach(k=>{ if(!['id','page'].includes(k)) delete e[k]; }); Object.assign(e,{type:'erase',x:r.x,y:r.y,w:r.w,h:r.h,mode:r.mode||'text',cover:false,coverColor:'#ffffff'}); schedulePreview(); }
      else { elements=elements.filter(o=>o.id!==id); if(selectedId===id) selectedId=null; }
    } }
  renderElements(); renderProps();
}

// ---------- properties panel ----------
function fontOptions(cur){
  let h='<optgroup label="Fontes incluídas (funcionam em qualquer computador)">'+Fonts.emb.map(f=>`<option value="${f.key}" ${f.key===cur?'selected':''}>${esc(f.label)}${f.sub!==f.label&&!f.label.startsWith(f.sub)?' — '+esc(f.sub):''}</option>`).join('')+'</optgroup>';
  h+='<optgroup label="Fontes básicas do PDF (arquivo menor)">'+Fonts.std.map(f=>`<option value="${f.key}" ${f.key===cur?'selected':''}>${esc(f.label)} (básica)</option>`).join('')+'</optgroup>';
  if(Fonts.local && Fonts.local.size){
    h+='<optgroup label="Fontes do computador">';
    for(const fam of Fonts.local.keys()){ const k='local:'+fam; h+=`<option value="${esc(k)}" ${k===cur?'selected':''} style="font-family:'${esc(fam)}'">${esc(fam)}</option>`; }
    h+='</optgroup>';
  } else if(cur.startsWith('local:')){
    h+=`<option value="${esc(cur)}" selected>${esc(cur.slice(6))} (carregue as fontes)</option>`;
  }
  return h;
}
function renderProps(){
  const e=getEl(selectedId);
  if(!e){
    let extra='';
    if(preview.stats.removed) extra=`<div class="stat" style="margin-top:12px">Texto removido: <b>${preview.stats.removed}</b> caracteres em ${new Set(eraseAreas().map(a=>a.page)).size} página(s).</div>`;
    propsEl.innerHTML=`<h3>Propriedades</h3><p class="none">${pdfJsDoc?'Selecione um item na página para editar as propriedades dele.':'Abra um PDF para começar.'}</p>${extra}
      <div class="count" id="elcount">${countText()}</div>`;
    return;
  }
  const T=TYPES[e.type]; let h=`<h3>${T.label}</h3>`;
  const colorRow=(cur,list,id)=>`<div class="row"><label>Cor</label><div class="swatches">${list.map(c=>`<span class="sw${c===cur?' on':''}" data-color="${c}" style="background:${c}" title="${c}"></span>`).join('')}
      <input type="color" id="${id||'p_color'}" value="${cur}" style="width:28px;height:26px;padding:0;border:0;background:none"></div></div>`;
  if(T.kind==='text'){
    const canB=Fonts.hasVariant(e.font,true,e.italic), canI=Fonts.hasVariant(e.font,e.bold,true);
    if(e.replaces) h+=`<p class="note" style="margin-top:-6px">Este texto substitui o original do PDF. Para voltar ao original, use <b>Restaurar original</b>.</p>`;
    h+=`<div class="row"><label>Texto (Enter cria nova linha)</label><textarea id="p_text">${esc(e.text)}</textarea></div>
      <div class="row"><label>Fonte</label><select id="p_font">${fontOptions(e.font)}</select>
        ${Fonts.supported && !Fonts.local ? '<div class="note">Opcional: <button class="linkbtn" id="p_loadFonts">usar também as fontes instaladas no computador</button></div>' : ''}
        ${e.font.startsWith('std:') ? '<div class="note">As fontes básicas só têm os caracteres do português/europeu ocidental. Para símbolos (✓ ☑ →), use DejaVu Sans.</div>' : ''}</div>
      <div class="row"><label>Tamanho e estilo</label><div class="pair"><input type="number" id="p_size" min="4" max="144" step="1" value="${e.size}">
        <div class="checks"><label title="${canB?'':'Esta fonte não tem versão negrito instalada'}"><input type="checkbox" id="p_bold" ${e.bold?'checked':''} ${canB||e.bold?'':'disabled'}><b>N</b></label>
        <label title="${canI?'':'Esta fonte não tem versão itálico instalada'}"><input type="checkbox" id="p_italic" ${e.italic?'checked':''} ${canI||e.italic?'':'disabled'}><i>I</i></label>
        <label title="Sublinhado"><input type="checkbox" id="p_under" ${e.underline?'checked':''}><u>S</u></label>
        <label title="Tachado"><input type="checkbox" id="p_strike" ${e.strike?'checked':''}><s>T</s></label></div></div></div>`+colorRow(e.color,COLORS);
  } else if(T.kind==='symbol'){
    h+=`<div class="row"><label>Tamanho (pt)</label><input type="number" id="p_wh" min="4" max="200" step="1" value="${Math.round(e.w)}"></div>`+colorRow(e.color,COLORS);
  } else if(T.kind==='image'){
    h+=`<div class="row"><label>Largura × altura (pt)</label><div class="pair"><input type="number" id="p_iw" min="8" value="${Math.round(e.w)}"><input type="number" value="${Math.round(e.h)}" disabled></div>
      <p class="note">Arraste o canto para redimensionar mantendo a proporção.</p></div>`;
  } else if(T.kind==='table'){
    const a=(actCell.id===e.id)?actCell:{r:0,c:0}; const r=Math.min(a.r,e.rowH.length-1), c=Math.min(a.c,e.colW.length-1);
    if(e.replaces) h+=`<p class="note" style="margin-top:-6px">Esta tabela substitui a original do PDF. <b>Restaurar original</b> desfaz a troca.</p>`;
    h+=`<div class="stat">${e.rowH.length} linha(s) × ${e.colW.length} coluna(s) · célula ativa: linha ${r+1}, coluna ${c+1}</div>
      <div class="row" style="margin-top:10px"><label>Texto da célula ativa</label><textarea id="t_cell" style="height:64px">${esc(e.cells[r][c]||'')}</textarea>
        <p class="note">Ou dê dois cliques na célula para digitar nela. <kbd>Tab</kbd> passa para a próxima.</p></div>
      <div class="pair" style="margin-bottom:6px"><button class="btn sm" id="t_rowAbove">+ Linha acima</button><button class="btn sm" id="t_rowBelow">+ Linha abaixo</button></div>
      <div class="pair" style="margin-bottom:6px"><button class="btn sm" id="t_colLeft">+ Coluna à esquerda</button><button class="btn sm" id="t_colRight">+ Coluna à direita</button></div>
      <div class="pair" style="margin-bottom:12px"><button class="btn sm danger" id="t_rowDel">Excluir linha</button><button class="btn sm danger" id="t_colDel">Excluir coluna</button></div>
      <div class="pair"><div class="row"><label>Largura da coluna (pt)</label><input type="number" id="t_colW" min="12" value="${Math.round(e.colW[c])}"></div>
        <div class="row"><label>Altura mínima da linha</label><input type="number" id="t_rowH" min="6" value="${Math.round(e.rowH[r])}"></div></div>
      <div class="row"><label>Fonte</label><select id="p_font">${fontOptions(e.font)}</select></div>
      <div class="pair"><div class="row"><label>Tamanho</label><input type="number" id="p_size" min="4" max="72" value="${e.size}"></div>
        <div class="row"><label>Alinhamento</label><select id="t_align"><option value="left" ${e.align==='left'?'selected':''}>Esquerda</option><option value="center" ${e.align==='center'?'selected':''}>Centro</option><option value="right" ${e.align==='right'?'selected':''}>Direita</option></select></div></div>
      ${colorRow(e.color,COLORS)}
      <div class="pair"><div class="row"><label>Borda</label><select id="t_bw">${[[0,'Sem borda'],[0.5,'Fina'],[0.75,'Normal'],[1.5,'Grossa']].map(([v,l])=>`<option value="${v}" ${+e.bw===v?'selected':''}>${l}</option>`).join('')}</select></div>
        <div class="row"><label>Cor da borda</label><input type="color" id="t_border" value="${e.border}" style="width:100%;height:32px;padding:0;border:1px solid var(--line);border-radius:6px"></div></div>
      <div class="row inline"><input type="checkbox" id="t_header" ${e.header?'checked':''}><label for="t_header">1ª linha como cabeçalho (negrito)</label></div>
      ${e.header?`<div class="row inline"><input type="checkbox" id="t_hfOn" ${e.headerFill?'checked':''}><label for="t_hfOn">Fundo no cabeçalho</label><input type="color" id="t_hf" value="${e.headerFill||'#e8eef5'}" style="width:34px;height:26px;padding:0;border:0;background:none"></div>`:''}`;
  } else if(T.kind==='erase'){
    const c=preview.stats.by[e.id];
    h+=`<div class="stat">${c===undefined?'Calculando…':c?`<b>${c}</b> caracteres serão removidos do arquivo.`:'Nenhum texto selecionável nesta área.'}</div>
      ${c===0?'<p class="note">Se o documento for uma digitalização (imagem), o texto não pode ser removido; marque <b>Cobrir com cor</b> para escondê-lo.</p>':''}
      <div class="opt" style="margin:10px 0">
        <label class="radio"><input type="radio" name="p_mode" value="text" ${e.mode!=='all'?'checked':''}><span>Somente o texto<small>Linhas, desenhos e imagens continuam</small></span></label>
        <label class="radio"><input type="radio" name="p_mode" value="all" ${e.mode==='all'?'checked':''}><span>Tudo na área<small>Texto, linhas, fundos e imagens — use para excluir tabelas</small></span></label>
      </div>
      <p class="note">O conteúdo é apagado de verdade (não fica escondido por baixo).${e.mode==='all'?` Elementos gráficos removidos: <b>${(preview.stats.gfx||{})[e.id]||0}</b>.`:''}</p>
      <div class="row inline" style="margin-top:10px"><input type="checkbox" id="p_cover" ${e.cover?'checked':''}><label for="p_cover">Cobrir a área com cor</label></div>
      ${e.cover?colorRow(e.coverColor,COVER_COLORS,'p_coverColor'):''}
      <div class="row"><label>Largura × altura (pt)</label><div class="pair"><input type="number" id="p_w" min="5" value="${Math.round(e.w)}"><input type="number" id="p_h" min="5" value="${Math.round(e.h)}"></div></div>`;
  } else {
    h+=`<div class="row"><label>${e.type==='radio'?'Nome do grupo':'Nome do campo'}</label><input type="text" id="p_name" value="${esc(e.name)}"><div class="err" id="p_name_err"></div></div>`;
    if(e.type==='radio'){
      const grp=elements.filter(o=>o.type==='radio'&&o.name===e.name).length;
      h+=`<div class="row"><label>Valor desta opção</label><input type="text" id="p_value" value="${esc(e.value)}"><div class="err" id="p_value_err"></div></div>
        <div class="row inline"><input type="checkbox" id="p_selected" ${e.selected?'checked':''}><label for="p_selected">Selecionada por padrão</label></div>
        <p class="note" style="margin-top:-4px">Este grupo tem ${grp} ${grp===1?'opção':'opções'}. Botões com o mesmo nome de grupo funcionam juntos: só um pode ser marcado.</p>`;
    }
    if(e.type==='ftext'||e.type==='fmulti'){
      h+=`<div class="row"><label>Texto inicial (opcional)</label>${e.type==='fmulti'?`<textarea id="p_value">${esc(e.value)}</textarea>`:`<input type="text" id="p_value" value="${esc(e.value)}">`}</div>
        <div class="row"><label>Tamanho da fonte (0 = automático)</label><input type="number" id="p_fontSize" min="0" max="72" value="${e.fontSize}"></div>`;
    }
    if(e.type==='dropdown'){
      h+=`<div class="row"><label>Opções (uma por linha)</label><textarea id="p_options">${esc(e.options.join('\n'))}</textarea></div>
        <div class="row"><label>Valor inicial</label><select id="p_value"><option value="">(nenhum)</option>${e.options.map(o=>`<option ${o===e.value?'selected':''}>${esc(o)}</option>`).join('')}</select></div>
        <div class="row"><label>Tamanho da fonte (0 = automático)</label><input type="number" id="p_fontSize" min="0" max="72" value="${e.fontSize}"></div>`;
    }
    if(e.type==='checkbox') h+=`<div class="row inline"><input type="checkbox" id="p_checked" ${e.checked?'checked':''}><label for="p_checked">Marcada por padrão</label></div>`;
    if(e.type!=='signature') h+=`<div class="row inline"><input type="checkbox" id="p_required" ${e.required?'checked':''}><label for="p_required">Preenchimento obrigatório</label></div>`;
    h+=`<div class="row inline"><input type="checkbox" id="p_border" ${e.border?'checked':''}><label for="p_border">Mostrar borda no PDF</label></div>`;
    h+=`<div class="row"><label>Largura × altura (pt)</label><div class="pair"><input type="number" id="p_w" min="5" value="${Math.round(e.w)}"><input type="number" id="p_h" min="5" value="${Math.round(e.h)}"></div></div>`;
  }
  if((T.kind==='image'||T.kind==='text'||T.kind==='symbol') && !e.replaces) h+=`<button class="btn del" id="p_rep" title="Coloca uma cópia na mesma posição em todas as outras páginas">Repetir em todas as páginas</button>`;
  h+=`<button class="btn danger del" id="p_del">${T.kind==='erase'?'Desfazer esta remoção':e.replaces?'Restaurar original':'Excluir item'}</button><div class="count" id="elcount">${countText()}</div>`;
  propsEl.innerHTML=h;
  bindProps(e);
}

function bindProps(e){
  const on=(id,ev,fn)=>{ const n=$('#'+id); if(n) n.addEventListener(ev,fn); };
  let snapped=false; const snap=()=>{ if(!snapped){ snapshot(); snapped=true; } };
  const refresh=()=>{ const n=document.querySelector(`.el[data-id="${e.id}"]`); if(n && !n.classList.contains('editing')) renderElements(); else if(n) positionNode(n,e); };
  const rememberText=()=>{ if(kind(e)==='text' && !e.replaces) lastText={font:e.font,size:e.size,color:e.color,bold:e.bold,italic:e.italic,underline:!!e.underline,strike:!!e.strike}; };
  on('p_text','input',ev=>{ snap(); e.text=ev.target.value; const n=document.querySelector(`.el[data-id="${e.id}"]`); if(n) n.textContent=e.text; });
  on('p_text','change',()=>{ if(!e.text.trim()){ elements=elements.filter(o=>o.id!==e.id); selectedId=null; renderElements(); renderProps(); } });
  on('p_font','change',async ev=>{ snap(); e.font=ev.target.value; await Fonts.ensure(e.font);
    if(e.bold && !Fonts.hasVariant(e.font,true,e.italic)) e.bold=false;
    if(e.italic && !Fonts.hasVariant(e.font,e.bold,true)) e.italic=false;
    rememberText(); refresh(); renderProps(); });
  on('p_loadFonts','click',async()=>{
    try{ const n=await Fonts.loadLocal(); toast(n+' famílias de fontes encontradas no computador.'); renderProps(); const s=$('#p_font'); if(s) s.focus(); }
    catch(err){ toast(err.name==='NotAllowedError'?'Permissão para ler as fontes foi negada.':friendlyError(err), true); }
  });
  on('p_size','input',ev=>{ const v=+ev.target.value; if(v>=4&&v<=144){ snap(); e.size=v; rememberText(); refresh(); } });
  on('p_size','change',()=>{ if(kind(e)==='table') renderProps(); });
  on('p_bold','change',ev=>{ snap(); e.bold=ev.target.checked; rememberText(); refresh(); renderProps(); });
  on('p_italic','change',ev=>{ snap(); e.italic=ev.target.checked; rememberText(); refresh(); renderProps(); });
  on('p_under','change',ev=>{ snap(); e.underline=ev.target.checked; rememberText(); refresh(); });
  on('p_strike','change',ev=>{ snap(); e.strike=ev.target.checked; rememberText(); refresh(); });
  propsEl.querySelectorAll('input[name="p_mode"]').forEach(r=>r.addEventListener('change',()=>{ snap(); e.mode=r.value; refresh(); renderProps(); schedulePreview(); }));
  if(kind(e)==='table') bindTableProps(e,snap,refresh);
  propsEl.querySelectorAll('.sw').forEach(s=>s.addEventListener('click',()=>{ snap();
    if(kind(e)==='erase') e.coverColor=s.dataset.color; else e.color=s.dataset.color; rememberText(); refresh(); renderProps(); }));
  on('p_color','input',ev=>{ snap(); e.color=ev.target.value; rememberText(); refresh(); });
  on('p_coverColor','input',ev=>{ snap(); e.coverColor=ev.target.value; refresh(); });
  on('p_cover','change',ev=>{ snap(); e.cover=ev.target.checked; refresh(); renderProps(); });
  on('p_wh','input',ev=>{ const v=+ev.target.value, pi=pageInfos[e.page]; if(v>=4){ snap(); e.w=e.h=Math.min(v,pi.w-e.x,pi.h-e.y); refresh(); } });
  on('p_w','input',ev=>{ const v=+ev.target.value, pi=pageInfos[e.page]; if(v>=5){ snap(); e.w=Math.min(v,pi.w-e.x); if(e.type==='radio'||e.type==='checkbox') e.h=e.w; refresh(); if(e.type==='erase') schedulePreview(); } });
  on('p_h','input',ev=>{ const v=+ev.target.value, pi=pageInfos[e.page]; if(v>=5){ snap(); e.h=Math.min(v,pi.h-e.y); if(e.type==='radio'||e.type==='checkbox') e.w=e.h; refresh(); if(e.type==='erase') schedulePreview(); } });
  on('p_name','input',ev=>{ const v=ev.target.value.trim(), err=$('#p_name_err'); const msg=validateName(e,v); err.textContent=msg||''; if(!msg){ snap(); e.name=v; refresh(); } });
  on('p_name','change',()=>renderProps());
  on('p_value','input',ev=>{
    if(e.type==='radio'){
      const v=ev.target.value.trim(), err=$('#p_value_err');
      if(!v){ err.textContent='O valor não pode ficar vazio.'; return; }
      if(elements.some(o=>o!==e&&o.type==='radio'&&o.name===e.name&&o.value===v)){ err.textContent='Já existe uma opção com esse valor neste grupo.'; return; }
      err.textContent=''; snap(); e.value=v; return;
    }
    snap(); e.value=ev.target.value; refresh();
  });
  on('p_value','change',ev=>{ if(e.type==='dropdown'){ snap(); e.value=ev.target.value; refresh(); } });
  on('p_fontSize','input',ev=>{ const v=+ev.target.value; if(v>=0&&v<=72){ snap(); e.fontSize=v; refresh(); } });
  on('p_options','input',ev=>{ snap(); e.options=ev.target.value.split('\n').map(s=>s.trim()).filter(Boolean); if(!e.options.includes(e.value)) e.value=''; });
  on('p_options','change',()=>{ refresh(); renderProps(); });
  on('p_checked','change',ev=>{ snap(); e.checked=ev.target.checked; refresh(); });
  on('p_selected','change',ev=>{ snap(); e.selected=ev.target.checked; if(e.selected) elements.forEach(o=>{ if(o!==e&&o.type==='radio'&&o.name===e.name) o.selected=false; }); refresh(); });
  on('p_required','change',ev=>{ snap(); e.required=ev.target.checked; });
  on('p_border','change',ev=>{ snap(); e.border=ev.target.checked; });
  on('p_del','click',()=>deleteSelected());
  on('p_iw','input',ev=>{ const v=+ev.target.value, pi=pageInfos[e.page]; if(v>=8){ snap(); e.w=Math.min(v,pi.w-e.x,(pi.h-e.y)*e.ratio); e.h=e.w/e.ratio; refresh(); } });
  on('p_rep','click',()=>{
    if(pageInfos.length<2){ toast('O PDF tem só uma página.'); return; }
    snapshot(); let n=0;
    pageInfos.forEach((pi,i)=>{ if(i===e.page) return; const c=JSON.parse(JSON.stringify(e)); c.id=nextId++; c.page=i;
      const bw=c.w||20, bh=c.h||c.size||10; c.x=Math.min(c.x,Math.max(0,pi.w-bw)); c.y=Math.min(c.y,Math.max(0,pi.h-bh)); elements.push(c); n++; });
    renderElements(); renderProps(); toast('Copiado para mais '+n+' página(s).');
  });
}
function validateName(e,v){
  if(!v) return 'O nome não pode ficar vazio.';
  if(/[.]/.test(v)) return 'Não use ponto (.) no nome.';
  if(existingFieldNames.has(v)) return 'Já existe um campo com esse nome no PDF original.';
  const clash=elements.find(o=>o!==e && kind(o)==='field' && o.name===v && !(e.type==='radio'&&o.type==='radio'));
  if(clash) return 'Já existe outro campo com esse nome.';
  return '';
}
function deleteSelected(){
  if(!selectedId) return;
  const se=getEl(selectedId)||{}; const wasErase=se.type==='erase'||!!se.replaces;
  if(editingId===selectedId) editingId=null;
  snapshot(); elements=elements.filter(o=>o.id!==selectedId); selectedId=null; renderElements(); renderProps();
  if(wasErase) schedulePreview();
}

// ---------- keyboard ----------
document.addEventListener('keydown',k=>{
  if(App.view!=='editor' || !$('#signModal').hidden) return;
  const typing=k.target.matches('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]');
  if((k.ctrlKey||k.metaKey) && k.key.toLowerCase()==='s'){ k.preventDefault(); if(pdfBytes) savePdf(); return; }
  if((k.ctrlKey||k.metaKey) && k.key.toLowerCase()==='o'){ k.preventDefault(); $('#file').click(); return; }
  if(typing) return;
  if((k.ctrlKey||k.metaKey) && k.key.toLowerCase()==='z'){ k.preventDefault(); undo(); return; }
  if(k.key==='Escape'){ if(tool) setTool(null); else select(null); return; }
  const e=getEl(selectedId); if(!e) return;
  if(k.key==='Delete'||k.key==='Backspace'){ k.preventDefault(); deleteSelected(); return; }
  if(k.key==='Enter' && e.type==='text'){ k.preventDefault(); startEditing(e.id); return; }
  const step=k.shiftKey?10:1, d={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[k.key];
  if(d){ k.preventDefault(); snapshot(); const pi=pageInfos[e.page];
    e.x=Math.max(0,Math.min(pi.w-(e.w||5),e.x+d[0])); e.y=Math.max(0,Math.min(pi.h-(e.h||5),e.y+d[1])); renderElements(); if(e.type==='erase') schedulePreview(); }
});

// ---------- saving ----------
async function savePdf(){
  if(editingId) stopEditing();
  for(const e of elements){
    if(kind(e)!=='field') continue;
    const m=validateName(e,e.name); if(m){ select(e.id); toast('Corrija o nome do campo "'+e.name+'": '+m, true); return; }
  }
  if(elements.some(e=>kind(e)==='text' && e.font.startsWith('local:') && Fonts.info(e.font).missing)){
    toast('Há textos com fontes do computador que ainda não foram carregadas. Selecione o texto e clique em "Carregar fontes do computador".', true); return;
  }
  busy(true,'Gerando PDF…');
  try{
    await Promise.all([...new Set(elements.filter(e=>e.font).map(e=>e.font))].map(k=>Fonts.ensure(k)));
    const doc=await loadPdfLib(pdfBytes);
    // 1) remove text first, so nothing we add afterwards is affected
    const areas=eraseAreas();
    if(areas.length) Erase.apply(doc, areas.map(e=>({page:e.page, rect:areaRect(e), id:e.id, mode:e.mode})));
    const pages=doc.getPages(); const form=doc.getForm();
    const fontCache={};
    const helv=(await embedFontFor(doc,fontCache,'std:Helvetica',false,false)).font;
    const radioGroups={}, createdText=[], imgCache={};
    let warned=false;
    for(const e of elements){
      const page=pages[e.page], vp=pageInfos[e.page].vp, rot=((vp.rotation%360)+360)%360;
      const P=(x,y)=>{ const [px,py]=vp.convertToPdfPoint(x,y); return {x:px,y:py}; };
      const k=kind(e);
      if(k==='erase'){
        if(e.cover){ const a=P(e.x,e.y), b=P(e.x+e.w,e.y+e.h);
          page.drawRectangle({x:Math.min(a.x,b.x), y:Math.min(a.y,b.y), width:Math.abs(b.x-a.x), height:Math.abs(b.y-a.y), color:hexToRgb(e.coverColor)}); }
        continue;
      }
      if(k==='text'){
        const fe=await embedFontFor(doc,fontCache,e.font,e.bold,e.italic);
        const bl=Fonts.baseline(e.font,e.bold,e.italic);
        e.text.split('\n').forEach((line,i)=>{
          const txt=cleanForFont(fe,line); if(txt!==line) warned=true;
          if(!txt) return;
          const by=e.y+(i*1.2+bl)*e.size; const o=P(e.x, by);
          page.drawText(txt,{x:o.x,y:o.y,size:e.size,font:fe.font,color:hexToRgb(e.color),rotate:degrees(rot)});
          if(e.underline||e.strike){ const tw=fe.font.widthOfTextAtSize(txt,e.size), th=Math.max(0.5,e.size*0.06);
            const lines=[]; if(e.underline) lines.push(by+e.size*0.12); if(e.strike) lines.push(by-e.size*0.28);
            for(const ly of lines) page.drawLine({start:P(e.x,ly),end:P(e.x+tw,ly),thickness:th,color:hexToRgb(e.color)}); }
        });
        continue;
      }
      if(k==='table'){ await drawTable(page,P,rot,e,doc,fontCache); continue; }
      if(k==='image'){
        let img=imgCache[e.src];
        if(!img){ const bytes=Uint8Array.from(atob(e.src.split(',')[1]),c=>c.charCodeAt(0));
          img=imgCache[e.src]= /^data:image\/png/.test(e.src) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes); }
        const o=P(e.x, e.y+e.h);
        page.drawImage(img,{x:o.x,y:o.y,width:e.w,height:e.h,rotate:degrees(rot)});
        continue;
      }
      if(k==='symbol'){
        const col=hexToRgb(e.color), sw=Math.max(.8,e.w*0.13);
        const pt=(u,v)=>P(e.x+e.w*u/100, e.y+e.h*v/100);
        if(e.type==='cross'){
          page.drawLine({start:pt(12,12),end:pt(88,88),thickness:sw,color:col,lineCap:1});
          page.drawLine({start:pt(88,12),end:pt(12,88),thickness:sw,color:col,lineCap:1});
        } else if(e.type==='check'){
          const a=pt(10,55),b=pt(38,83),c=pt(92,18);
          page.drawSvgPath(`M ${a.x} ${-a.y} L ${b.x} ${-b.y} L ${c.x} ${-c.y}`,{x:0,y:0,borderColor:col,borderWidth:sw,borderLineCap:1});
        } else if(e.type==='dot'){
          const c=pt(50,50); page.drawEllipse({x:c.x,y:c.y,xScale:e.w/2,yScale:e.h/2,color:col});
        }
        continue;
      }
      // form fields
      const a=P(e.x,e.y), b=P(e.x+e.w,e.y+e.h);
      const rect={x:Math.min(a.x,b.x), y:Math.min(a.y,b.y), width:Math.abs(b.x-a.x), height:Math.abs(b.y-a.y)};
      const R=rect; let anchor; // pdf-lib re-rotates the rectangle; pre-compensate
      if(rot===90) anchor={x:R.x+R.width, y:R.y, width:R.height, height:R.width};
      else if(rot===180) anchor={x:R.x+R.width, y:R.y+R.height, width:R.width, height:R.height};
      else if(rot===270) anchor={x:R.x, y:R.y+R.height, width:R.height, height:R.width};
      else anchor={...R};
      const look={...anchor, textColor:rgb(0,0,0), rotate:degrees(rot), backgroundColor:undefined};
      if(e.border){ look.borderColor=rgb(.45,.5,.55); look.borderWidth=1; } else { look.borderColor=undefined; look.borderWidth=0; }
      const helvE={font:helv,std:true};
      if(e.type==='ftext'||e.type==='fmulti'){
        const f=form.createTextField(e.name);
        if(e.type==='fmulti') f.enableMultiline();
        if(e.value) f.setText(cleanForFont(helvE,e.value));
        if(e.required) f.enableRequired();
        f.addToPage(page,{...look,font:helv});
        if(e.fontSize) f.setFontSize(e.fontSize);
        createdText.push([f,e.fontSize]);
      } else if(e.type==='dropdown'){
        const f=form.createDropdown(e.name);
        const opts=e.options.map(o=>cleanForFont(helvE,o));
        if(opts.length) f.addOptions(opts);
        const v=cleanForFont(helvE,e.value||''); if(v && opts.includes(v)) f.select(v);
        if(e.required) f.enableRequired();
        f.addToPage(page,{...look,font:helv});
        if(e.fontSize) f.setFontSize(e.fontSize);
        createdText.push([f,e.fontSize]);
      } else if(e.type==='checkbox'){
        const f=form.createCheckBox(e.name); f.addToPage(page,look);
        if(e.checked) f.check(); if(e.required) f.enableRequired();
      } else if(e.type==='radio'){
        let g=radioGroups[e.name]; if(!g) g=radioGroups[e.name]=form.createRadioGroup(e.name);
        g.addOptionToPage(e.value,page,look);
        if(e.selected) g.select(e.value); if(e.required) g.enableRequired();
      } else if(e.type==='signature'){
        const l1=P(e.x+e.w*0.08,e.y+e.h*0.72), l2=P(e.x+e.w*0.92,e.y+e.h*0.72);
        addSignatureField(doc,form,page,e.name,rect,e.border,[l1.x-rect.x,l1.y-rect.y,l2.x-rect.x,l2.y-rect.y]);
      }
    }
    if(createdText.length || Object.keys(radioGroups).length || elements.some(e=>kind(e)==='field')){
      form.updateFieldAppearances(helv);
      const ctx=doc.context, af=form.acroForm.dict;
      let dr=af.lookup(PDFName.of('DR')); if(!dr){ dr=ctx.obj({}); af.set(PDFName.of('DR'),dr); }
      let drFonts=dr.lookup(PDFName.of('Font')); if(!drFonts){ drFonts=ctx.obj({}); dr.set(PDFName.of('Font'),drFonts); }
      if(!drFonts.get(PDFName.of('Helv'))) drFonts.set(PDFName.of('Helv'), helv.ref);
      if(!af.get(PDFName.of('DA'))) af.set(PDFName.of('DA'), PDFString.of('/Helv 0 Tf 0 g'));
      for(const [f,size] of createdText) f.acroField.setDefaultAppearance(`/Helv ${size||0} Tf 0 g`);
    }
    const out=await doc.save({updateFieldAppearances:false});
    const ok=await download(out, baseName(fileName)+' - editado.pdf');
    const big=Object.values(fontCache).filter(f=>f.big).map(f=>f.name);
    if(ok) toast(warned?'PDF salvo. Alguns caracteres que a fonte não tem viraram "?".'
      : big.length?`PDF salvo (${fmtBytes(out.length)}). A fonte ${big.join(', ')} precisou ir inteira no arquivo; use outra fonte se quiser um PDF menor.`
      : 'PDF salvo com sucesso.', warned);
  }catch(err){ console.error(err); toast('Erro ao salvar: '+friendlyError(err), true); }
  finally{ busy(false); }
}

function addSignatureField(doc,form,page,name,r,border,line){
  const ctx=doc.context;
  const ops=`q 0.45 0.5 0.55 RG 0.75 w `+(border?`0.5 0.5 ${r.width-1} ${r.height-1} re S `:'')+`[2 2] 0 d ${line[0]} ${line[1]} m ${line[2]} ${line[3]} l S Q`;
  const apRef=ctx.register(ctx.stream(ops,{Type:'XObject',Subtype:'Form',BBox:[0,0,r.width,r.height]}));
  const widget=ctx.obj({ Type:'Annot', Subtype:'Widget', FT:'Sig', T:PDFString.of(name), F:4,
    Rect:[r.x,r.y,r.x+r.width,r.y+r.height], P:page.ref, MK:ctx.obj(border?{BC:[0.45,0.5,0.55]}:{}), AP:ctx.obj({N:apRef}) });
  const ref=ctx.register(widget);
  page.node.addAnnot(ref); form.acroForm.addField(ref);
  form.acroForm.dict.set(PDFName.of('SigFlags'), PDFNumber.of(1));
}

// ---------- wiring ----------
$('#btnOpen').onclick=$('#btnOpen2').onclick=()=>$('#file').click();
$('#file').onchange=ev=>{ openFile(ev.target.files[0]); ev.target.value=''; };
$('#btnSave').onclick=()=>savePdf();
$('#btnUndo').onclick=()=>undo();
$('#zoomIn').onclick=()=>setZoom(zoom+0.15);
$('#zoomOut').onclick=()=>setZoom(zoom-0.15);
viewer.addEventListener('wheel',ev=>{ if(ev.ctrlKey){ ev.preventDefault(); setZoom(zoom*(ev.deltaY<0?1.1:1/1.1)); } },{passive:false});
dropZone(viewer, files=>{ const f=files.find(isPdfFile); if(f) openFile(f); else toast('Solte um arquivo PDF.',true); });
window.addEventListener('beforeunload',ev=>{ if(elements.length){ ev.preventDefault(); ev.returnValue=''; } });

window.__prancheta={openFile, addElement, addErase, savePdf, setTool, runPreview, editExisting, convertTable, editCell, get elements(){return elements;}, get preview(){return preview;}, set downloadHook(fn){ window.__dl=fn; }};
renderProps();
})();
