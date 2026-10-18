# Prancheta PDF

Editor de PDF que roda **inteiramente no navegador**, sem instalar nada e sem enviar arquivos para a internet.

**Usar agora:** https://gilbertoviana91.github.io/prancheta-pdf/

Também funciona offline: baixe o `index.html` e abra no Edge ou no Chrome.

## Funções

- **Editar:** editar o texto existente do PDF, adicionar texto (negrito, itálico, sublinhado, tachado), símbolos ✕ ✓ ●, tabelas, imagens e assinatura (desenhada, digitada ou imagem)
- **Conteúdo do PDF:** apagar texto de verdade, apagar áreas inteiras (texto, linhas, imagens), transformar tabelas do PDF em tabelas editáveis
- **Formulários:** campos de texto, texto multilinha, lista suspensa, botões de opção, caixas de seleção e campo de assinatura
- **Organizar:** girar, excluir, duplicar, reordenar e inserir páginas
- **Juntar** e **Dividir** PDFs
- **Comprimir** (recompressão de imagens ou páginas em imagem)
- **Numerar** páginas, cabeçalho e rodapé
- **OCR** em português (PDF pesquisável), rodando localmente
- **Converter:** PDF → JPG/PNG/TXT e imagens → PDF

Fontes incluídas (equivalentes métricos de código aberto): Arial (Liberation Sans), Calibri (Carlito), Cambria (Caladea), Times New Roman (Liberation Serif), Courier New (Liberation Mono) e DejaVu Sans.

## Como é feito

O `index.html` é gerado a partir de `src/` pelo `build.py`, que embute as bibliotecas e fontes:
[pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0), [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT),
[fontkit](https://github.com/Hopding/fontkit) (MIT), [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0)
e fontes sob SIL OFL 1.1 / licença Bitstream Vera. As licenças completas estão em `third_party_licenses/`
e também dentro do aplicativo (botão "Licenças e créditos").
