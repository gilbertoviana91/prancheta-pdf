import base64, pathlib
root=pathlib.Path(__file__).resolve().parent
src=root/'src'; v=root/'vendor'
def lib(path):
    js=(v/path).read_text(encoding='utf-8')
    return js.replace('</script','<\\/script').replace('</SCRIPT','<\\/SCRIPT')
app='\n'.join((src/f).read_text(encoding='utf-8') for f in ['core.js','erase.js','sign.js','editor.js','modules.js','pages2.js'])
assert '</script' not in app.lower()
out=(src/'template.html').read_text(encoding='utf-8')
parts={
 '/*STYLES*/':(src/'styles.css').read_text(encoding='utf-8'),
 '<!--BODY-->':(src/'body.html').read_text(encoding='utf-8'),
 '/*PDFJS*/':lib('pdfjs-dist-3.11.174/package/build/pdf.min.js'),
 '/*PDFLIB*/':lib('pdf-lib-1.17.1/package/dist/pdf-lib.min.js'),
 '/*FONTKIT*/':lib('fontkit/package/dist/fontkit.umd.min.js'),
 '/*PDFJS_WORKER_B64*/':base64.b64encode((v/'pdfjs-dist-3.11.174/package/build/pdf.worker.min.js').read_bytes()).decode(),
 '/*APP*/':app,
 '/*TESSERACT*/':lib('tesseract.js-5.1.1/package/dist/tesseract.min.js'),
 '/*OCR_CORE*/':lib('tesseract.js-core-5.1.1/package/tesseract-core-simd-lstm.wasm.js'),
 '/*OCR_WORKER*/':lib('tesseract.js-5.1.1/package/dist/worker.min.js'),
 '/*OCR_LANG_B64*/':base64.b64encode((v/'tesseract.js-data-por-1.0.0/package/4.0.0_best_int/por.traineddata.gz').read_bytes()).decode(),
}
for k,val in parts.items():
    assert k in out, k
    out=out.replace(k,val,1)
import gzip
FONTS={'LiberationSans-Regular':'liberation/LiberationSans-Regular.ttf','LiberationSans-Bold':'liberation/LiberationSans-Bold.ttf','LiberationSans-Italic':'liberation/LiberationSans-Italic.ttf','LiberationSans-BoldItalic':'liberation/LiberationSans-BoldItalic.ttf',
 'LiberationSerif-Regular':'liberation/LiberationSerif-Regular.ttf','LiberationSerif-Bold':'liberation/LiberationSerif-Bold.ttf','LiberationSerif-Italic':'liberation/LiberationSerif-Italic.ttf','LiberationSerif-BoldItalic':'liberation/LiberationSerif-BoldItalic.ttf',
 'LiberationMono-Regular':'liberation/LiberationMono-Regular.ttf','LiberationMono-Bold':'liberation/LiberationMono-Bold.ttf','LiberationMono-Italic':'liberation/LiberationMono-Italic.ttf','LiberationMono-BoldItalic':'liberation/LiberationMono-BoldItalic.ttf',
 'Carlito-Regular':'crosextra/Carlito-Regular.ttf','Carlito-Bold':'crosextra/Carlito-Bold.ttf','Carlito-Italic':'crosextra/Carlito-Italic.ttf','Carlito-BoldItalic':'crosextra/Carlito-BoldItalic.ttf',
 'Caladea-Regular':'crosextra/Caladea-Regular.ttf','Caladea-Bold':'crosextra/Caladea-Bold.ttf','Caladea-Italic':'crosextra/Caladea-Italic.ttf','Caladea-BoldItalic':'crosextra/Caladea-BoldItalic.ttf',
 'DejaVuSans':'dejavu/DejaVuSans.ttf','DejaVuSans-Bold':'dejavu/DejaVuSans-Bold.ttf'}
fdir=root/'vendor'/'fonts'
FONT_ASSETS=''.join(f'<script type="text/plain" id="font-{k}">'+base64.b64encode(gzip.compress((fdir/v).read_bytes(),9,mtime=0)).decode()+'</script>\n' for k,v in FONTS.items())
lic='\n\n'.join('===== '+f.stem+' =====\n'+f.read_text(encoding='utf-8',errors='replace') for f in sorted((root/'vendor'/'licenses').glob('*.txt')))
LICENSES='<script type="text/plain" id="licenses">\nPrancheta PDF inclui software e fontes de terceiros, sob as licenças abaixo.\n'+lic.replace('</','<\\/')+'</script>\n'
out=out.replace('<!--ASSETS-->',FONT_ASSETS+LICENSES,1)
dest=root/'dist'/'Prancheta PDF.html'; dest.parent.mkdir(exist_ok=True); dest.write_text(out,encoding='utf-8')
print(dest, round(len(out)/1e6,2),'MB')
