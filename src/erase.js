// =====================================================================
// erase: remove text glyphs inside rectangles from page content streams
// (real removal: the characters disappear from the file, the rest stays in place)
// =====================================================================
const Erase = (function(){
  const WS = new Set([0,9,10,12,13,32]);
  const DELIM = new Set([40,41,60,62,91,93,123,125,47,37]);
  const latin1 = new TextDecoder('latin1');

  function decodeStream(s){
    if(s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
    if(s && typeof s.getContents==='function') return s.getContents(); // PDFContentStream
    return new Uint8Array(0);
  }

  // ---------- tokenizer / operation parser ----------
  function parseOps(src){
    const n=src.length; let i=0; const ops=[]; let args=[]; let argStart=-1;
    function skipWs(){ while(i<n){ const c=src[i]; if(WS.has(c)) i++; else if(c===37){ while(i<n && src[i]!==10 && src[i]!==13) i++; } else break; } }
    function readObj(){
      skipWs(); if(i>=n) return null;
      const c=src[i], s=i;
      if(c===40){ // literal string
        i++; let depth=1; const out=[];
        while(i<n && depth>0){
          let ch=src[i++];
          if(ch===92){ // backslash
            const e=src[i++];
            if(e===110) out.push(10); else if(e===114) out.push(13); else if(e===116) out.push(9);
            else if(e===98) out.push(8); else if(e===102) out.push(12);
            else if(e===40||e===41||e===92) out.push(e);
            else if(e===13){ if(src[i]===10) i++; }
            else if(e===10){}
            else if(e>=48&&e<=55){ let v=e-48; for(let k=0;k<2 && src[i]>=48 && src[i]<=55;k++) v=v*8+(src[i++]-48); out.push(v&255); }
            else out.push(e);
          } else if(ch===40){ depth++; out.push(ch); }
          else if(ch===41){ depth--; if(depth>0) out.push(ch); }
          else out.push(ch);
        }
        return {t:'str', v:Uint8Array.from(out), s, e:i};
      }
      if(c===60){
        if(src[i+1]===60){ // dictionary: skip balanced
          i+=2; let depth=1;
          while(i<n && depth>0){
            if(src[i]===60 && src[i+1]===60){ depth++; i+=2; }
            else if(src[i]===62 && src[i+1]===62){ depth--; i+=2; }
            else if(src[i]===40){ readObj(); }
            else i++;
          }
          return {t:'dict', s, e:i};
        }
        i++; let hex='';
        while(i<n && src[i]!==62){ const ch=src[i++]; if(!WS.has(ch)) hex+=String.fromCharCode(ch); }
        i++; if(hex.length%2) hex+='0';
        const v=new Uint8Array(hex.length/2); for(let k=0;k<v.length;k++) v[k]=parseInt(hex.substr(k*2,2),16)||0;
        return {t:'str', v, s, e:i, hex:true};
      }
      if(c===91){ i++; const arr=[]; for(;;){ skipWs(); if(i>=n) break; if(src[i]===93){ i++; break; } const o=readObj(); if(!o) break; arr.push(o); } return {t:'arr', v:arr, s, e:i}; }
      if(c===47){ i++; const st=i; while(i<n && !WS.has(src[i]) && !DELIM.has(src[i])) i++; return {t:'name', v:latin1.decode(src.subarray(st,i)), s, e:i}; }
      if(c===93||c===41||c===62||c===123||c===125){ i++; return {t:'junk', s, e:i}; }
      // number or keyword
      const st=i; while(i<n && !WS.has(src[i]) && !DELIM.has(src[i])) i++;
      if(i===st){ i++; return {t:'junk', s, e:i}; }
      const w=latin1.decode(src.subarray(st,i));
      if(/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) return {t:'num', v:parseFloat(w), s, e:i};
      return {t:'kw', v:w, s, e:i};
    }
    while(true){
      skipWs(); if(i>=n) break;
      const o=readObj(); if(!o) break;
      if(o.t==='kw' && !['true','false','null'].includes(o.v)){
        if(o.v==='BI'){ // inline image: skip to EI
          let j=o.e;
          // find "ID" keyword
          while(j<n-1 && !(src[j]===73 && src[j+1]===68 && WS.has(src[j-1]) && (WS.has(src[j+2])||j+2>=n))) j++;
          j+=3;
          while(j<n-1 && !(src[j]===69 && src[j+1]===73 && WS.has(src[j-1]) && (j+2>=n || WS.has(src[j+2])))) j++;
          i=Math.min(n,j+2);
          ops.push({op:'BI', args:[], s:argStart>=0?argStart:o.s, e:i});
        } else {
          ops.push({op:o.v, args, s:argStart>=0?argStart:o.s, e:o.e});
        }
        args=[]; argStart=-1;
      } else { if(argStart<0) argStart=o.s; args.push(o); }
    }
    return ops;
  }

  // ---------- matrices ----------
  const I=[1,0,0,1,0,0];
  function mul(A,B){ return [A[0]*B[0]+A[1]*B[2], A[0]*B[1]+A[1]*B[3], A[2]*B[0]+A[3]*B[2], A[2]*B[1]+A[3]*B[3], A[4]*B[0]+A[5]*B[2]+B[4], A[4]*B[1]+A[5]*B[3]+B[5]]; }
  function apply(M,x,y){ return [M[0]*x+M[2]*y+M[4], M[1]*x+M[3]*y+M[5]]; }

  // ---------- font metrics ----------
  function num(o,d){ return o instanceof PDFNumber ? o.asNumber() : d; }
  function fontInfo(doc, fontDict, cache){
    const key=fontDict; if(cache.has(key)) return cache.get(key);
    const L=k=>fontDict.lookup(PDFName.of(k));
    const sub=fontDict.lookup(PDFName.of('Subtype'));
    const info={bytes:1, width:()=>0.5, ok:true};
    try{
      if(sub===PDFName.of('Type0')){
        const enc=fontDict.lookup(PDFName.of('Encoding'));
        info.bytes=2;
        if(enc instanceof PDFName){
          const nm=enc.decodeText();
          if(!/Identity|UCS2|UTF16/i.test(nm)) info.ok=false;
        } else if(enc instanceof PDFRawStream){
          const txt=latin1.decode(decodeStream(enc));
          const ranges=[...txt.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)].map(m=>m[1].length);
          const cs=txt.split('begincodespacerange')[1]; const m2=cs?[...cs.split('endcodespacerange')[0].matchAll(/<([0-9a-fA-F]+)>/g)].map(m=>m[1].length):ranges;
          if(m2.length && m2.every(l=>l===4)) info.bytes=2; else if(m2.length && m2.every(l=>l===2)) info.bytes=1; else info.ok=false;
        }
        const desc=fontDict.lookup(PDFName.of('DescendantFonts'));
        const df=desc instanceof PDFArray ? desc.lookup(0) : null;
        let dw=1000; const W=new Map();
        if(df instanceof PDFDict){
          dw=num(df.lookup(PDFName.of('DW')),1000);
          const w=df.lookup(PDFName.of('W'));
          if(w instanceof PDFArray){
            const a=w.asArray().map(x=>x instanceof PDFRef ? doc.context.lookup(x) : x);
            for(let k=0;k<a.length;){
              const c1=num(a[k],0), nx=a[k+1];
              if(nx instanceof PDFArray){ const ws=nx.asArray().map(x=>num(x instanceof PDFRef?doc.context.lookup(x):x,dw)); ws.forEach((wv,j)=>W.set(c1+j,wv)); k+=2; }
              else { const c2=num(nx,c1), wv=num(a[k+2],dw); for(let c=c1;c<=c2 && c-c1<65536;c++) W.set(c,wv); k+=3; }
            }
          }
        }
        info.width=code=>(W.has(code)?W.get(code):dw)/1000;
      } else {
        const fc=num(L('FirstChar'),0);
        const ws=L('Widths');
        const fd=L('FontDescriptor');
        const missing=fd instanceof PDFDict ? num(fd.lookup(PDFName.of('MissingWidth')),0) : 0;
        let arr=null; if(ws instanceof PDFArray) arr=ws.asArray().map(x=>num(x instanceof PDFRef?doc.context.lookup(x):x,missing));
        let scale=1/1000;
        if(sub===PDFName.of('Type3')){ const fm=L('FontMatrix'); if(fm instanceof PDFArray) scale=num(fm.lookup(0),0.001); }
        const base=(L('BaseFont') instanceof PDFName) ? L('BaseFont').decodeText().replace(/^[A-Z]{6}\+/,'') : '';
        const stdW=/Courier/i.test(base)?0.6:0.5;
        const std=arr?null:stdEmbedder(base);
        info.width=code=>{
          if(arr){ const w=arr[code-fc]; return (w===undefined?missing:w)*scale; }
          if(std){ try{ const g=std.encodeTextAsGlyphs(winAnsiChar(code)); return std.widthOfGlyph(g[0].name)/1000; }catch(_){ } }
          return stdW;
        };
        if(!arr && !std) info.approx=true;
      }
    }catch(e){ console.warn('font metrics', e); info.ok=false; }
    cache.set(key,info); return info;
  }

  // metrics for the 14 standard fonts (PDFs may omit /Widths for them)
  const stdCache={};
  function stdEmbedder(base){
    const b=base.toLowerCase(); const bold=/bold|black|heavy/.test(b), it=/italic|oblique/.test(b);
    let fam=null;
    if(/helvetica|arial/.test(b)) fam='Helvetica'; else if(/times/.test(b)) fam='Times'; else if(/courier/.test(b)) fam='Courier';
    if(!fam) return null;
    const map={Helvetica:['Helvetica','HelveticaBold','HelveticaOblique','HelveticaBoldOblique'],Times:['TimesRoman','TimesRomanBold','TimesRomanItalic','TimesRomanBoldItalic'],Courier:['Courier','CourierBold','CourierOblique','CourierBoldOblique']}[fam];
    const name=StandardFonts[map[(bold?1:0)+(it?2:0)]];
    try{ return stdCache[name]||(stdCache[name]=PDFLib.StandardFontEmbedder.for(name)); }catch(_){ return null; }
  }
  const WIN80='€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
  function winAnsiChar(code){ return code>=0x80&&code<=0x9f ? WIN80[code-0x80] : String.fromCharCode(code); }
  function toHex(bytes){ let s='<'; for(const b of bytes) s+=(b<16?'0':'')+b.toString(16); return s+'>'; }
  function fmt(n){ return (Math.round(n*1000)/1000).toString(); }

  // ---------- process one content stream ----------
  // rects: [{x0,y0,x1,y1}] in default user space; returns {bytes, removed} or null if unchanged
  function processContent(doc, bytes, resources, rects, ctm0, depth, stats, fontCache){
    const src=bytes; const ops=parseOps(src);
    const repl=[]; // [s,e,text]
    let gs={ctm:ctm0.slice(), Tc:0, Tw:0, Tz:100, TL:0, font:null, fs:0, Ts:0};
    const stack=[];
    let Tm=I.slice(), Tlm=I.slice();
    const fontsDict = resources instanceof PDFDict ? resources.lookup(PDFName.of('Font')) : null;
    const xobjDict = resources instanceof PDFDict ? resources.lookup(PDFName.of('XObject')) : null;
    const inside=(x,y)=>{ for(const r of rects){ if(x>=r.x0&&x<=r.x1&&y>=r.y0&&y<=r.y1) return r; } return null; };

    function getFont(name){
      if(!(fontsDict instanceof PDFDict)) return null;
      const fd=fontsDict.lookup(PDFName.of(name));
      if(!(fd instanceof PDFDict)) return null;
      return fontInfo(doc, fd, fontCache);
    }
    // show a string; returns {parts:[{bytes}|{adj}], changed}
    function show(strBytes){
      const fi=gs.font; const fs=gs.fs, Th=gs.Tz/100;
      const parts=[]; let changed=false; let cur=[];
      const flushKeep=()=>{ if(cur.length){ parts.push({bytes:Uint8Array.from(cur)}); cur=[]; } };
      const bpc = fi ? fi.bytes : 1;
      for(let k=0;k<strBytes.length;k+=bpc){
        const codeBytes=strBytes.subarray(k,k+bpc);
        let code=0; for(const b of codeBytes) code=code*256+b;
        const w0=fi?fi.width(code):0.5;
        const tw=(bpc===1 && code===32)?gs.Tw:0;
        const adv=(w0*fs + gs.Tc + tw)*Th;
        let remove=false;
        if(fi && fi.ok && fs!==0){
          const M=mul(Tm, gs.ctm);
          const [cx,cy]=apply(M, (w0*fs*Th)/2, gs.Ts+0.3*fs);
          const hit=inside(cx,cy); remove=!!hit;
          if(hit && hit.id!==undefined) stats.by[hit.id]=(stats.by[hit.id]||0)+1;
        }
        if(remove){
          flushKeep(); changed=true; stats.removed++;
          const n=-(w0*fs + gs.Tc + tw)*1000/fs;
          const last=parts[parts.length-1];
          if(last && last.adj!==undefined) last.adj+=n; else parts.push({adj:n});
        } else {
          for(const b of codeBytes) cur.push(b);
        }
        Tm=mul([1,0,0,1,adv,0],Tm);
      }
      flushKeep();
      return {parts, changed};
    }
    function adjMove(n){ const tx=-n/1000*gs.fs*(gs.Tz/100); Tm=mul([1,0,0,1,tx,0],Tm); }
    function partsToTJ(parts){
      let s='['; for(const p of parts){ if(p.bytes) s+=toHex(p.bytes); else s+=' '+fmt(p.adj)+' '; } return s+'] TJ';
    }
    function nextLine(){ Tlm=mul([1,0,0,1,0,-gs.TL],Tlm); Tm=Tlm.slice(); }

    const allRects=rects.filter(r=>r.mode==='all');
    let pb=null; // current path bbox in user space
    const addPt=(x,y)=>{ const [ux,uy]=apply(gs.ctm,x,y); if(!pb) pb={x0:ux,y0:uy,x1:ux,y1:uy}; else { pb.x0=Math.min(pb.x0,ux); pb.y0=Math.min(pb.y0,uy); pb.x1=Math.max(pb.x1,ux); pb.y1=Math.max(pb.y1,uy); } };
    const boxInside=b=>{ if(!b) return null; for(const r of allRects){ if(b.x0>=r.x0-0.75&&b.x1<=r.x1+0.75&&b.y0>=r.y0-0.75&&b.y1<=r.y1+0.75) return r; } return null; };
    const unitBox=()=>{ const pts=[[0,0],[1,0],[0,1],[1,1]].map(([x,y])=>apply(gs.ctm,x,y)); return {x0:Math.min(...pts.map(p=>p[0])),y0:Math.min(...pts.map(p=>p[1])),x1:Math.max(...pts.map(p=>p[0])),y1:Math.max(...pts.map(p=>p[1]))}; };
    const countG=r=>{ stats.gfx=stats.gfx||{}; if(r.id!==undefined) stats.gfx[r.id]=(stats.gfx[r.id]||0)+1; stats.graphics=(stats.graphics||0)+1; };
    for(const o of ops){
      const a=o.args; const N=k=>(a[k]&&a[k].t==='num')?a[k].v:0;
      if(allRects.length){
        switch(o.op){
          case 'm': case 'l': addPt(N(0),N(1)); break;
          case 'c': addPt(N(0),N(1)); addPt(N(2),N(3)); addPt(N(4),N(5)); break;
          case 'v': case 'y': addPt(N(0),N(1)); addPt(N(2),N(3)); break;
          case 're': addPt(N(0),N(1)); addPt(N(0)+N(2),N(1)+N(3)); break;
          case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': {
            const r=boxInside(pb); if(r){ repl.push([o.s,o.e,'n']); countG(r); } pb=null; break; }
          case 'n': pb=null; break;
          case 'BI': { const r=boxInside(unitBox()); if(r){ repl.push([o.s,o.e,'']); countG(r); } break; }
          case 'Do': {
            if(xobjDict instanceof PDFDict && a[0] && a[0].t==='name'){
              const xo=xobjDict.lookup(PDFName.of(a[0].v));
              if(xo instanceof PDFRawStream && xo.dict.lookup(PDFName.of('Subtype'))===PDFName.of('Image')){
                const r=boxInside(unitBox()); if(r){ repl.push([o.s,o.e,'']); countG(r); continue; }
              }
            }
            break;
          }
        }
      }
      switch(o.op){
        case 'q': stack.push({...gs, ctm:gs.ctm.slice()}); break;
        case 'Q': if(stack.length) gs=stack.pop(); break;
        case 'cm': if(a.length>=6) gs.ctm=mul([N(0),N(1),N(2),N(3),N(4),N(5)],gs.ctm); break;
        case 'BT': Tm=I.slice(); Tlm=I.slice(); break;
        case 'Tf': gs.font=(a[0]&&a[0].t==='name')?getFont(a[0].v):null; gs.fs=N(1); break;
        case 'Tc': gs.Tc=N(0); break;
        case 'Tw': gs.Tw=N(0); break;
        case 'Tz': gs.Tz=N(0); break;
        case 'TL': gs.TL=N(0); break;
        case 'Ts': gs.Ts=N(0); break;
        case 'Td': Tlm=mul([1,0,0,1,N(0),N(1)],Tlm); Tm=Tlm.slice(); break;
        case 'TD': gs.TL=-N(1); Tlm=mul([1,0,0,1,N(0),N(1)],Tlm); Tm=Tlm.slice(); break;
        case 'Tm': Tlm=[N(0),N(1),N(2),N(3),N(4),N(5)]; Tm=Tlm.slice(); break;
        case 'T*': nextLine(); break;
        case 'Tj': { const sObj=a[a.length-1]; if(sObj&&sObj.t==='str'){ const r=show(sObj.v); if(r.changed) repl.push([o.s,o.e,partsToTJ(r.parts)]); } break; }
        case "'": { nextLine(); const sObj=a[a.length-1]; if(sObj&&sObj.t==='str'){ const r=show(sObj.v); if(r.changed) repl.push([o.s,o.e,'T* '+partsToTJ(r.parts)]); } break; }
        case '"': { gs.Tw=N(0); gs.Tc=N(1); nextLine(); const sObj=a[2]; if(sObj&&sObj.t==='str'){ const r=show(sObj.v); if(r.changed) repl.push([o.s,o.e,`${fmt(N(0))} Tw ${fmt(N(1))} Tc T* `+partsToTJ(r.parts)]); } break; }
        case 'TJ': {
          const arr=a[a.length-1]; if(!arr||arr.t!=='arr') break;
          const parts=[]; let changed=false;
          for(const el of arr.v){
            if(el.t==='num'){ adjMove(el.v); const last=parts[parts.length-1]; if(last&&last.adj!==undefined) last.adj+=el.v; else parts.push({adj:el.v}); }
            else if(el.t==='str'){ const r=show(el.v); if(r.changed) changed=true;
              for(const p of r.parts){ const last=parts[parts.length-1]; if(p.adj!==undefined && last && last.adj!==undefined) last.adj+=p.adj; else parts.push(p); } }
          }
          if(changed) repl.push([o.s,o.e,partsToTJ(parts)]);
          break;
        }
        case 'Do': {
          if(depth>6 || !(xobjDict instanceof PDFDict) || !a[0] || a[0].t!=='name') break;
          const name=a[0].v; const xo=xobjDict.lookup(PDFName.of(name));
          if(!(xo instanceof PDFRawStream)) break;
          if(xo.dict.lookup(PDFName.of('Subtype'))!==PDFName.of('Form')) break;
          const mtx=xo.dict.lookup(PDFName.of('Matrix'));
          const m = mtx instanceof PDFArray ? mtx.asArray().map(x=>num(x,0)) : I;
          const res = xo.dict.lookup(PDFName.of('Resources')) || resources;
          const out = processContent(doc, decodeStream(xo), res, rects, mul(m,gs.ctm), depth+1, stats, fontCache);
          if(out){
            const ns=doc.context.flateStream(out);
            for(const [k,v] of xo.dict.entries()){ const kk=k.asString(); if(kk!=='/Filter'&&kk!=='/DecodeParms'&&kk!=='/Length') ns.dict.set(k,v); }
            const ref=doc.context.register(ns);
            let newName; let t=1; do{ newName=name+'_pe'+(t++); }while(xobjDict.get(PDFName.of(newName)));
            xobjDict.set(PDFName.of(newName),ref);
            repl.push([o.s,o.e,`/${newName} Do`]);
          }
          break;
        }
      }
    }
    if(!repl.length) return null;
    // splice replacements
    repl.sort((x,y)=>x[0]-y[0]);
    const enc=new TextEncoder(); const chunks=[]; let pos=0;
    for(const [s,e,t] of repl){ chunks.push(src.subarray(pos,s)); chunks.push(enc.encode(t)); pos=e; }
    chunks.push(src.subarray(pos));
    const total=chunks.reduce((s,c)=>s+c.length,0); const out=new Uint8Array(total); let off=0;
    for(const c of chunks){ out.set(c,off); off+=c.length; }
    return out;
  }

  // apply to a pdf-lib document. areas: [{page, rect:{x0,y0,x1,y1}}]
  function apply_(doc, areas){
    const stats={removed:0, by:{}, gfx:{}, graphics:0}; const fontCache=new Map();
    const pages=doc.getPages();
    const byPage=new Map(); areas.forEach(a=>{ if(!byPage.has(a.page)) byPage.set(a.page,[]); byPage.get(a.page).push({...a.rect, id:a.id, mode:a.mode||'text'}); });
    for(const [pi,rects] of byPage){
      const page=pages[pi]; if(!page) continue;
      const node=page.node;
      const contents=node.lookup(PDFName.of('Contents'));
      let streams=[];
      if(contents instanceof PDFArray) streams=contents.asArray().map(r=>doc.context.lookup(r));
      else if(contents) streams=[contents];
      if(!streams.length) continue;
      const parts=streams.map(decodeStream);
      const total=parts.reduce((s,p)=>s+p.length+1,0); const joined=new Uint8Array(total); let off=0;
      for(const p of parts){ joined.set(p,off); off+=p.length; joined[off++]=10; }
      const res=node.Resources();
      const out=processContent(doc, joined, res, rects, I, 0, stats, fontCache);
      if(out){ node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(out))); }
    }
    return stats;
  }
  // axis-aligned line segments drawn on a page (user space): used to detect table grids
  function segments(doc, pageIndex){
    const page=doc.getPages()[pageIndex]; const node=page.node;
    const contents=node.lookup(PDFName.of('Contents'));
    let streams=[]; if(contents instanceof PDFArray) streams=contents.asArray().map(r=>doc.context.lookup(r)); else if(contents) streams=[contents];
    const parts=streams.map(decodeStream); const total=parts.reduce((s,p)=>s+p.length+1,0); const joined=new Uint8Array(total); let off=0;
    for(const p of parts){ joined.set(p,off); off+=p.length; joined[off++]=10; }
    const segs=[];
    (function walk(bytes, resources, ctm0, depth){
      const ops=parseOps(bytes); let ctm=ctm0.slice(); const st=[]; let cur=null, rectsP=[], linesP=[], polys=[], poly=null;
      const xo = resources instanceof PDFDict ? resources.lookup(PDFName.of('XObject')) : null;
      const T=(x,y)=>apply(ctm,x,y);
      const reset=()=>{ rectsP=[]; linesP=[]; cur=null; polys=[]; poly=null; };
      const thinPolys=()=>{ for(const pl of polys){ if(pl.length<3) continue; const xs=pl.map(p=>p[0]), ys=pl.map(p=>p[1]);
        const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
        if(x1-x0<=2.5 && y1-y0>2.5) segs.push({x0:(x0+x1)/2,y0,x1:(x0+x1)/2,y1}); else if(y1-y0<=2.5 && x1-x0>2.5) segs.push({x0,y0:(y0+y1)/2,x1,y1:(y0+y1)/2}); } };
      for(const o of ops){
        const a=o.args; const N=k=>(a[k]&&a[k].t==='num')?a[k].v:0;
        switch(o.op){
          case 'q': st.push(ctm.slice()); break;
          case 'Q': if(st.length) ctm=st.pop(); break;
          case 'cm': ctm=mul([N(0),N(1),N(2),N(3),N(4),N(5)],ctm); break;
          case 'm': cur=T(N(0),N(1)); poly=[cur]; polys.push(poly); break;
          case 'l': { const p=T(N(0),N(1)); if(cur) linesP.push([cur,p]); cur=p; if(poly) poly.push(p); break; }
          case 'c': cur=T(N(4),N(5)); break; case 'v': case 'y': cur=T(N(2),N(3)); break;
          case 're': { const p0=T(N(0),N(1)), p1=T(N(0)+N(2),N(1)+N(3)); rectsP.push([p0,p1]); break; }
          case 'S': case 's': case 'B': case 'B*': case 'b': case 'b*':
            linesP.forEach(([p,q])=>segs.push({x0:p[0],y0:p[1],x1:q[0],y1:q[1]}));
            rectsP.forEach(([p,q])=>{ const x0=Math.min(p[0],q[0]),x1=Math.max(p[0],q[0]),y0=Math.min(p[1],q[1]),y1=Math.max(p[1],q[1]);
              segs.push({x0,y0,x1,y1:y0},{x0,y0:y1,x1,y1},{x0,y0,x1:x0,y1},{x0:x1,y0,x1,y1}); });
            reset(); break;
          case 'f': case 'F': case 'f*':
            thinPolys();
            rectsP.forEach(([p,q])=>{ const x0=Math.min(p[0],q[0]),x1=Math.max(p[0],q[0]),y0=Math.min(p[1],q[1]),y1=Math.max(p[1],q[1]);
              if(x1-x0<=2.5) segs.push({x0:(x0+x1)/2,y0,x1:(x0+x1)/2,y1}); else if(y1-y0<=2.5) segs.push({x0,y0:(y0+y1)/2,x1,y1:(y0+y1)/2}); });
            reset(); break;
          case 'n': reset(); break;
          case 'Do': {
            if(depth>5 || !(xo instanceof PDFDict) || !a[0] || a[0].t!=='name') break;
            const x=xo.lookup(PDFName.of(a[0].v)); if(!(x instanceof PDFRawStream) || x.dict.lookup(PDFName.of('Subtype'))!==PDFName.of('Form')) break;
            const mtx=x.dict.lookup(PDFName.of('Matrix')); const m=mtx instanceof PDFArray?mtx.asArray().map(v=>num(v,0)):I;
            walk(decodeStream(x), x.dict.lookup(PDFName.of('Resources'))||resources, mul(m,ctm), depth+1); break;
          }
        }
      }
    })(joined, node.Resources(), I, 0);
    return segs.filter(g=>Math.abs(g.x0-g.x1)<0.6 || Math.abs(g.y0-g.y1)<0.6);
  }
  return { apply: apply_, parseOps, segments };
})();
