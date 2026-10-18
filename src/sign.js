// =====================================================================
// sign: hand-drawn / typed / image signatures and generic image picking
// =====================================================================
const Sign=(function(){
  const LS='prancheta.assinaturas';
  const CURSIVE=['Segoe Script','Lucida Handwriting','Ink Free','Brush Script MT','Freestyle Script','Mistral','Monotype Corsiva','Gabriola','Segoe Print','Bradley Hand','Snell Roundhand','URW Chancery L','Z003'];
  let resolver=null, tab='draw', penColor='#0b2a6b', penWidth=2.6, typedFont=null, strokes=[], current=null, imgData=null;
  const modal=$('#signModal');

  function loadSaved(){ try{ return JSON.parse(localStorage.getItem(LS)||'[]'); }catch(_){ return []; } }
  function storeSaved(list){ try{ localStorage.setItem(LS, JSON.stringify(list.slice(0,10))); return true; }catch(_){ return false; } }

  // which cursive fonts exist on this computer (compare against fallback metrics)
  function availableCursive(){
    const c=document.createElement('canvas').getContext('2d'), probe='Assinatura Wy 123';
    const width=f=>{ c.font=`40px ${f}`; return c.measureText(probe).width; };
    const base=[width('monospace'),width('serif'),width('sans-serif')];
    const out=CURSIVE.filter(f=>{ const w=[width(`"${f}", monospace`),width(`"${f}", serif`),width(`"${f}", sans-serif`)]; return w.some((v,i)=>Math.abs(v-base[i])>0.5); });
    if(!out.length) out.push('cursive');
    return out.slice(0,6);
  }

  // ---------- drawing pad ----------
  const pad=$('#signPad'); const pctx=pad.getContext('2d');
  function sizePad(){
    const r=pad.getBoundingClientRect(), dpr=Math.max(2,window.devicePixelRatio||1);
    pad.width=Math.round(r.width*dpr); pad.height=Math.round(r.height*dpr); redraw();
  }
  function redraw(){
    pctx.setTransform(1,0,0,1,0,0); pctx.clearRect(0,0,pad.width,pad.height);
    const sx=pad.width/pad.getBoundingClientRect().width||1; pctx.setTransform(sx,0,0,sx,0,0);
    for(const s of strokes) drawStroke(pctx,s);
    $('#signPadHint').hidden=strokes.length>0;
  }
  function drawStroke(g,s){
    g.strokeStyle=s.color; g.lineWidth=s.width; g.lineCap='round'; g.lineJoin='round';
    const p=s.pts; if(!p.length) return;
    g.beginPath(); g.moveTo(p[0].x,p[0].y);
    if(p.length===1){ g.lineTo(p[0].x+0.1,p[0].y+0.1); }
    for(let i=1;i<p.length-1;i++){ const mx=(p[i].x+p[i+1].x)/2, my=(p[i].y+p[i+1].y)/2; g.quadraticCurveTo(p[i].x,p[i].y,mx,my); }
    if(p.length>1){ const l=p[p.length-1]; g.lineTo(l.x,l.y); }
    g.stroke();
  }
  pad.addEventListener('pointerdown',ev=>{
    ev.preventDefault(); pad.setPointerCapture(ev.pointerId);
    const r=pad.getBoundingClientRect();
    current={color:penColor,width:penWidth,pts:[{x:ev.clientX-r.left,y:ev.clientY-r.top}]}; strokes.push(current); redraw();
  });
  pad.addEventListener('pointermove',ev=>{
    if(!current) return; const r=pad.getBoundingClientRect();
    const evs=ev.getCoalescedEvents?ev.getCoalescedEvents():[ev];
    for(const e of evs) current.pts.push({x:e.clientX-r.left,y:e.clientY-r.top});
    redraw();
  });
  ['pointerup','pointercancel'].forEach(t=>pad.addEventListener(t,()=>{ current=null; }));
  $('#signClear').onclick=()=>{ strokes=[]; redraw(); };
  $('#signUndo').onclick=()=>{ strokes.pop(); redraw(); };
  $$('#signPens .sw').forEach(s=>s.onclick=()=>{ penColor=s.dataset.color; $$('#signPens .sw').forEach(x=>x.classList.toggle('on',x===s)); $('#signTypedPrev') && renderTypedOptions(); });
  $('#signWidth').oninput=e=>{ penWidth=+e.target.value; };

  // ---------- typed ----------
  function renderTypedOptions(){
    const name=$('#signName').value.trim()||'Seu nome';
    const box=$('#signFonts'); box.innerHTML='';
    for(const f of availableCursive()){
      const b=document.createElement('button'); b.className='fontopt'+(f===typedFont?' on':''); b.type='button';
      b.style.fontFamily=f==='cursive'?'cursive':`"${f}", cursive`; b.style.color=penColor; b.textContent=name; b.title=f;
      b.onclick=()=>{ typedFont=f; renderTypedOptions(); };
      box.appendChild(b);
    }
    if(!typedFont) { typedFont=availableCursive()[0]; box.firstChild && box.firstChild.classList.add('on'); }
  }
  $('#signName').addEventListener('input',renderTypedOptions);

  // ---------- image ----------
  async function fileToCanvas(file){
    const bmp=await createImageBitmap(file);
    const max=2000, s=Math.min(1,max/Math.max(bmp.width,bmp.height));
    const c=document.createElement('canvas'); c.width=Math.round(bmp.width*s); c.height=Math.round(bmp.height*s);
    c.getContext('2d').drawImage(bmp,0,0,c.width,c.height); bmp.close&&bmp.close();
    return c;
  }
  function whiteToAlpha(c){
    const g=c.getContext('2d'), d=g.getImageData(0,0,c.width,c.height), p=d.data;
    for(let i=0;i<p.length;i+=4){ const l=(p[i]*0.299+p[i+1]*0.587+p[i+2]*0.114);
      if(l>232) p[i+3]=0; else if(l>200) p[i+3]=Math.round(p[i+3]*(232-l)/32); }
    g.putImageData(d,0,0); return c;
  }
  $('#signImgBtn').onclick=async()=>{ const fs=await pick({accept:'image/*'}); if(!fs.length) return;
    try{ imgData={canvas:await fileToCanvas(fs[0])}; showImgPreview(); }catch(e){ toast('Não consegui abrir essa imagem.',true); } };
  $('#signImgWhite').onchange=showImgPreview;
  function showImgPreview(){
    const box=$('#signImgPrev'); box.innerHTML='';
    if(!imgData){ box.innerHTML='<span class="none">Nenhuma imagem escolhida.</span>'; return; }
    const c=document.createElement('canvas'); c.width=imgData.canvas.width; c.height=imgData.canvas.height;
    c.getContext('2d').drawImage(imgData.canvas,0,0); if($('#signImgWhite').checked) whiteToAlpha(c);
    imgData.processed=c; c.style.maxWidth='100%'; c.style.maxHeight='180px'; box.appendChild(c);
  }

  // ---------- saved ----------
  function renderSaved(){
    const list=loadSaved(), box=$('#signSavedList'); box.innerHTML='';
    if(!list.length){ box.innerHTML='<p class="none">Nenhuma assinatura salva ainda. Ao criar uma, deixe marcado "Guardar para usar depois".</p>'; return; }
    list.forEach((s,i)=>{
      const d=document.createElement('div'); d.className='savedsig';
      d.innerHTML=`<img alt="Assinatura ${i+1}"><button class="x" title="Excluir">×</button>`; d.querySelector('img').src=s.src;
      d.onclick=ev=>{ if(ev.target.closest('.x')){ ev.stopPropagation(); const l=loadSaved(); l.splice(i,1); storeSaved(l); renderSaved(); return; } finish({src:s.src, ratio:s.ratio, defaultW:140}); };
      box.appendChild(d);
    });
  }

  // ---------- produce a trimmed PNG ----------
  function trim(c){
    const g=c.getContext('2d'), d=g.getImageData(0,0,c.width,c.height).data;
    let x0=c.width,y0=c.height,x1=-1,y1=-1;
    for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++){ if(d[(y*c.width+x)*4+3]>8){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; } }
    if(x1<0) return null;
    const padPx=Math.round(Math.max(c.width,c.height)*0.01)+4;
    x0=Math.max(0,x0-padPx); y0=Math.max(0,y0-padPx); x1=Math.min(c.width-1,x1+padPx); y1=Math.min(c.height-1,y1+padPx);
    const o=document.createElement('canvas'); o.width=x1-x0+1; o.height=y1-y0+1; o.getContext('2d').drawImage(c,-x0,-y0);
    return o;
  }
  function buildResult(){
    let c=null;
    if(tab==='draw'){
      if(!strokes.length){ toast('Desenhe a assinatura no quadro.'); return null; }
      const r=pad.getBoundingClientRect(), k=4; c=document.createElement('canvas'); c.width=Math.round(r.width*k); c.height=Math.round(r.height*k);
      const g=c.getContext('2d'); g.setTransform(k,0,0,k,0,0); strokes.forEach(s=>drawStroke(g,s));
    } else if(tab==='type'){
      const name=$('#signName').value.trim(); if(!name){ toast('Digite o nome.'); return null; }
      c=document.createElement('canvas'); const g=c.getContext('2d'); const fam=typedFont==='cursive'?'cursive':`"${typedFont}", cursive`;
      g.font=`160px ${fam}`; const w=Math.ceil(g.measureText(name).width)+80; c.width=w; c.height=260;
      g.font=`160px ${fam}`; g.fillStyle=penColor; g.textBaseline='middle'; g.fillText(name,40,135);
    } else if(tab==='image'){
      if(!imgData||!imgData.processed){ toast('Escolha uma imagem.'); return null; }
      c=imgData.processed;
    } else return null;
    const t=trim(c); if(!t){ toast('A assinatura está vazia.'); return null; }
    const src=t.toDataURL('image/png'); const ratio=t.width/t.height;
    if($('#signKeep').checked && tab!=='saved'){ const l=loadSaved(); l.unshift({src,ratio}); if(!storeSaved(l)) toast('Não foi possível guardar a assinatura neste navegador.',true); }
    return {src, ratio, defaultW:Math.min(170, 45*ratio)};
  }

  // ---------- modal plumbing ----------
  function setTab(t){
    tab=t; $$('#signTabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
    $$('.signpane').forEach(p=>p.hidden=p.dataset.tab!==t);
    $('#signKeepRow').hidden=t==='saved'; $('#signOk').hidden=t==='saved';
    if(t==='draw') requestAnimationFrame(sizePad);
    if(t==='type') renderTypedOptions();
    if(t==='saved') renderSaved();
  }
  $$('#signTabs button').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
  function finish(v){ modal.hidden=true; const r=resolver; resolver=null; if(r) r(v); }
  $('#signCancel').onclick=()=>finish(null);
  $('#signOk').onclick=()=>{ const v=buildResult(); if(v) finish(v); };
  modal.addEventListener('pointerdown',ev=>{ if(ev.target===modal) finish(null); });
  document.addEventListener('keydown',ev=>{ if(!modal.hidden && ev.key==='Escape'){ ev.stopPropagation(); finish(null); } },true);
  window.addEventListener('resize',()=>{ if(!modal.hidden && tab==='draw') sizePad(); });

  function open(){
    return new Promise(res=>{
      resolver=res; modal.hidden=false;
      setTab(loadSaved().length?'saved':'draw');
    });
  }
  async function pickImage(){
    const fs=await pick({accept:'image/png,image/jpeg,image/webp,image/gif,image/bmp'}); if(!fs.length) return null;
    try{
      const c=await fileToCanvas(fs[0]);
      const png=/png|gif|webp/i.test(fs[0].type);
      const src=c.toDataURL(png?'image/png':'image/jpeg',0.92);
      return {src, ratio:c.width/c.height, defaultW:Math.min(200, c.width*0.75)};
    }catch(e){ toast('Não consegui abrir essa imagem.',true); return null; }
  }
  return {open, pickImage, _test:{get strokes(){return strokes;}, setTab}};
})();
