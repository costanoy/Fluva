export type Lang = 'pt' | 'en';

/**
 * A flat, hand-maintained dictionary rather than a full i18n library — the
 * app is small enough that ICU-style pluralization/formatting machinery
 * would outweigh what it buys. Every dynamic string takes its variables as
 * `{name}` placeholders, filled in by `t()` below.
 */
const pt = {
  // ---- home / empty state ----
  'home.pageTitle': 'Fluva — Editor de PDF e imagens online grátis',
  'home.dropzoneTitle': 'Arraste seus arquivos aqui ou clique para selecionar',
  'home.dropzoneSub': 'PDF · PNG · JPG — até 50MB por arquivo',
  'home.dismiss': 'Dispensar',
  'home.remove': 'Remover {name}',
  'home.edit': 'Editar',
  'home.changeFormat': 'Alterar formato',
  'home.convertAllTo': 'Converter todos para',
  'home.cancel': 'Cancelar',
  'home.convertAndDownload': 'Converter e baixar',

  // ---- beta / "test the app" screen ----
  'beta.title': 'Teste o nosso aplicativo!',
  'beta.body':
    'Tenha o Fluva no seu próprio celular se inscrevendo para uma versão de testes. É só mandar um e-mail para {email} informando que deseja participar da versão de apps que eu liberarei o acesso na hora.',
  'beta.back': 'Voltar',

  // ---- top bar ----
  'topbar.renameTitle': 'Renomear arquivo',
  'topbar.renameAria': 'Nome do arquivo para exportação',
  'topbar.page': '{count} página',
  'topbar.pages': '{count} páginas',
  'topbar.backHome': 'Voltar ao início',
  'topbar.testApp': 'Teste o nosso app',
  'topbar.donate': 'Doe para o Fluva',
  'topbar.donateTitle': 'Ajude o Fluva a continuar no ar',
  'topbar.donateMessage':
    "O Fluva é completamente gratuito, mantenho o site online e disponível para todos com os meus próprios recursos. Caso tenha interesse em ajudar, pode fazer uma doação pro pix 142.353.286-46 com qualquer valor. Desde já, sou muito grato pelo seu interesse em ajudar no meu projeto!",
  'topbar.donateQrAlt': 'QR code Pix para doação',
  'topbar.export': 'Exportar',
  'topbar.close': 'Fechar',
  'topbar.lang': 'Idioma',

  // ---- export dropdown ----
  'export.asPdf': 'Exportar como PDF',
  'export.asImageHeading': 'Exportar como imagem',
  'export.asPng': 'Exportar como PNG',
  'export.asJpg': 'Exportar como JPG',
  'export.orAsDocument': 'ou exportar como documento',
  'export.orConvertTo': 'ou converter para',
  'export.word': 'Word (.docx)',
  'export.beta': 'BETA',

  // ---- toolbar ----
  'toolbar.edit': 'Editar',
  'toolbar.merge': 'Juntar PDFs',
  'toolbar.split': 'Dividir PDF',
  'toolbar.compress': 'Comprimir',
  'toolbar.rotate': 'Rodar',
  'toolbar.rotateTitle': 'Rodar página',
  'toolbar.watermark': "Marca d'água",
  'toolbar.reorder': 'Organizar',
  'toolbar.undo': 'Desfazer (Ctrl+Z)',
  'toolbar.redo': 'Refazer (Ctrl+Shift+Z)',
  'toolbar.zoomAria': 'Zoom da página',
  'toolbar.zoomTitle': 'Zoom: {pct}%',

  // ---- thumbnail rail ----
  'rail.pageLabel': 'pág. {n}',
  'rail.pageAria': 'Página {n}',
  'rail.deletePageAria': 'Excluir página {n}',
  'rail.addBlankPage': 'Adicionar página em branco',
  'rail.mergeFilesLabel': 'Arquivos para juntar',
  'rail.noOtherPdf': 'Nenhum outro PDF carregado ainda.',
  'rail.addPdfs': 'Adicionar PDFs',

  // ---- right panel: "Adicionar" ----
  'panel.addToPage': 'Adicionar à página {n}',
  'panel.addText': 'Adicionar texto',
  'panel.captureFontActive': 'Clique em qualquer texto do site (Esc para cancelar)',
  'panel.captureFontCaptured': 'Fonte capturada — clique para capturar outra',
  'panel.captureFontIdle': 'Captar fonte de um texto existente',
  'panel.addImage': 'Adicionar imagem',
  'panel.addShape': 'Adicionar forma',
  'panel.rotatePage': 'Girar página 90°',
  'panel.deletePage': 'Excluir página',
  'panel.clickToReplace': 'Clique em um trecho de texto na página para substituí-lo.',
  'panel.movingTextTitle': 'Movendo texto',
  'panel.movingTextNote': 'Clique em qualquer parte do texto na página e arraste para reposicioná-lo. Pressione Enter ou clique em Ok quando terminar.',
  'panel.ok': 'Ok',

  // ---- overlay panel (text / image / shape / cover) ----
  'overlay.textTitle': 'Texto',
  'overlay.content': 'Conteúdo',
  'overlay.font': 'Fonte',
  'overlay.size': 'Tamanho',
  'overlay.color': 'Cor',
  'overlay.rotation': 'Rotação: {deg}°',
  'overlay.moveText': 'Mover texto',
  'overlay.removeText': 'Remover texto',
  'overlay.imageTitle': 'Imagem',
  'overlay.imageNote': 'Arraste na página para mover, ou use a alça no canto para redimensionar.',
  'overlay.rotate90': 'Girar 90°',
  'overlay.removeImage': 'Remover imagem',
  'overlay.shapeTitle': 'Forma',
  'overlay.confirmPlacement': 'Confirmar colocação',
  'overlay.shapeFormat': 'Formato',
  'overlay.rectangle': 'Retângulo',
  'overlay.circle': 'Círculo',
  'overlay.removeShape': 'Remover forma',
  'overlay.coverTitle': 'Cobertura',
  'overlay.coverNote': 'Retângulo que cobre o texto original substituído.',
  'overlay.removeCover': 'Remover cobertura',
  'overlay.pickColorTitle': 'Escolher cor (RGB)',
  'overlay.pickScreenColor': 'Capturar cor da tela',
  'overlay.colorAria': 'Cor {hex}',
  'overlay.width': 'L',
  'overlay.height': 'A',

  // ---- text run panel (replacing original PDF text) ----
  'run.title': 'Substituir texto',
  'run.text': 'Texto',
  'run.originalFont': 'Fonte original',
  'run.exactMatch': 'substituta com métrica idêntica',
  'run.approxMatch': 'substituta aproximada',
  'run.substituteFont': 'Fonte substituta',
  'run.inPlaceOf': ' — no lugar de {names}',
  'run.applyFontToDoc': 'Aplicar esta fonte a todo o documento',
  'run.applyFontTitle':
    'Procura, em todas as páginas, outros textos com a mesma fonte original e aplica esta mesma substituta a todos, mantendo o negrito/itálico e as cores de cada um',
  'run.replaceText': 'Substituir texto',
  'run.moveText': 'Mover texto',
  'run.moveTextTitle': 'Solta o texto do PDF original para você arrastá-lo livremente pela página',
  'run.cancel': 'Cancelar',
  'run.moveHandleTitle': 'Segure e arraste para mover',
  'run.moveHandleAria': 'Mover texto',
  'run.detectedRun': '{font} · {size}pt — clique para substituir',

  // ---- merge panel ----
  'merge.title': 'Juntar PDFs',
  'merge.note': 'Marque na coluna à esquerda os arquivos a juntar. Aqui você define a ordem em que as páginas entram no final do documento atual.',
  'merge.noneSelected': 'Nenhum arquivo selecionado.',
  'merge.order': 'Ordem de junção',
  'merge.removeAria': 'Remover {name}',
  'merge.confirm': 'Juntar {count} arquivo(s) · +{pages} páginas',
  'merge.pages': '{count} pág.',

  // ---- compress panel ----
  'compress.title': 'Comprimir',
  'compress.intensity': 'Intensidade',
  'compress.levelLow': 'Leve',
  'compress.levelMedium': 'Equilibrada',
  'compress.levelHigh': 'Máxima',
  'compress.note':
    'Documentos digitalizados ou com muitas imagens são recodificados como imagem, o que reduz bastante o tamanho. Arquivos de texto já otimizados são mantidos como estão, sem perder qualidade.',
  'compress.runNow': 'Comprimir agora',
  'compress.before': 'Antes',
  'compress.after': 'Depois',
  'compress.reduced': '−{pct}% de tamanho',
  'compress.alreadyMin': 'Este arquivo já está no menor tamanho possível.',
  'compress.rasterNote': 'As páginas viraram imagem, então o texto não fica mais selecionável.',
  'compress.rebuildNote': 'Recodificar como imagem deixaria o arquivo maior, então o documento foi mantido com o texto selecionável.',
  'compress.downloadPdf': 'Baixar PDF',

  // ---- watermark panel ----
  'wm.title': "Marca d'água",
  'wm.active': "Marca d'água ativa",
  'wm.activate': "Ativar marca d'água",
  'wm.text': 'Texto',
  'wm.image': 'Imagem',
  'wm.imageLoaded': 'Imagem carregada',
  'wm.swapImage': 'Trocar imagem',
  'wm.allPages': 'Em todas as páginas',
  'wm.onlySelected': 'Apenas na selecionada',
  'wm.posH': 'Posição horizontal',
  'wm.posV': 'Posição vertical',
  'wm.scale': 'Tamanho',
  'wm.rotation': 'Rotação',
  'wm.remove': "Remover marca d'água",

  // ---- reorder panel + preview ----
  'reorder.title': 'Organizar páginas',
  'reorder.note': 'Arraste as páginas na área central ou na coluna à esquerda para reordenar o documento.',
  'reorder.previewNote': 'Arraste uma página e solte sobre outra para reordenar o documento.',
  'reorder.pageLabel': 'pág. {n}',

  // ---- split panel + preview ----
  'split.title': 'Dividir PDF',
  'split.range': 'Intervalo',
  'split.pages': 'Páginas',
  'split.autoInterval': 'Intervalo automático',
  'split.chooseInterval': 'Escolher intervalo',
  'split.howManyParts': 'Dividir em quantas partes?',
  'split.autoNote': 'As {total} páginas serão divididas em {parts} arquivo(s), o mais equilibrado possível.',
  'split.intervals': 'Intervalos',
  'split.noIntervals': 'Nenhum intervalo adicionado ainda.',
  'split.from': 'de',
  'split.to': 'até',
  'split.removeIntervalAria': 'Remover intervalo {n}',
  'split.addInterval': 'Adicionar intervalo',
  'split.divide': 'Dividir',
  'split.extractAll': 'Extrair todas',
  'split.selectPages': 'Selecionar páginas',
  'split.eachPageNote': 'Cada uma das {total} páginas vira um PDF separado, entregues em um .zip.',
  'split.clickToSelect': 'Clique nas páginas na área central para selecioná-las.',
  'split.mergeSelected': 'Mesclar páginas selecionadas em um único PDF',
  'split.selectedCount': '{count} página(s) selecionada(s).',
  'split.extractCount': 'Extrair {count} arquivos',
  'split.extractSelected': 'Extrair selecionadas',
  'split.previewTitle': 'Pré-visualização da divisão',
  'split.mergedLabel': 'mesclada',
  'split.ownFileLabel': 'arquivo próprio',
  'split.file': 'Arquivo {n}',
  'split.interval': 'Intervalo {n}',
  'split.outcomeAuto': '{total} página(s) divididas em {parts} arquivo(s): {sizes} página(s).',
  'split.outcomeCustomEmpty': 'Adicione um intervalo no painel à direita para ver a divisão aqui.',
  'split.outcomeCustom': '{count} intervalo(s) definido(s), gerando {count} arquivo(s). Páginas fora dos intervalos não entram em nenhum arquivo.',
  'split.outcomeAll': 'Cada uma das {total} páginas vira um PDF separado, entregues em um .zip.',
  'split.outcomeSelectEmpty': 'Clique nas páginas abaixo para selecioná-las.',
  'split.outcomeSelectMerge': '{count} página(s) selecionada(s) serão mescladas em um único PDF.',
  'split.outcomeSelectSeparate': '{count} página(s) selecionada(s) viram {count} PDF(s) separados.',

  // ---- footer ----
  'footer.tagline': 'Editor de PDF e imagens',

  // ---- unsaved-changes / navigation ----
  'nav.unsavedChanges': 'Você tem alterações não exportadas neste documento. Se voltar, elas serão perdidas. Deseja continuar?',

  // ---- toasts / busy labels / errors from the store ----
  'store.genericError': 'Algo deu errado.',
  'store.rejectedFormat': '{name} (formato não suportado)',
  'store.rejectedSize': '{name} ({size}, acima de 50MB)',
  'store.ignored': 'Ignorado: {list}',
  'store.openingFiles': 'Abrindo arquivos…',
  'store.filesJoined': '{count} arquivos juntados em um único documento.',
  'store.convertingTo': 'Convertendo para {format}…',
  'store.filesConverted': '{count} arquivo(s) convertido(s) para {format}.',
  'store.newText': 'Novo texto',
  'store.insertingImage': 'Inserindo imagem…',
  'store.applying': 'Aplicando…',
  'store.findingFont': 'Procurando esta fonte no documento…',
  'store.fontNotIdentified': 'Não foi possível identificar essa fonte.',
  'store.noOtherFontFound': 'Nenhum outro texto com essa fonte foi encontrado no documento.',
  'store.textsUpdated': '{count} texto(s) atualizado(s) para {font}.',
  'store.loadingWatermark': "Carregando marca d'água…",
  'store.loadingPdfs': 'Carregando PDFs…',
  'store.filesJoinedCount': '{count} arquivo(s) juntados — {pages} páginas adicionadas.',
  'store.dividing': 'Dividindo…',
  'store.addAtLeastOneInterval': 'Adicione pelo menos um intervalo.',
  'store.dividedInto': 'Dividido em {count} arquivo(s).',
  'store.selectAtLeastOnePage': 'Selecione ao menos uma página.',
  'store.pdfsPerPage': '{count} PDFs gerados, um por página.',
  'store.pagesMergedIntoOne': 'Páginas selecionadas mescladas em um PDF.',
  'store.pdfsFromSelection': '{count} PDFs gerados a partir das páginas selecionadas.',
  'store.compressing': 'Comprimindo…',
  'store.exporting': 'Exportando…',
  'store.pdfExported': '{name}.pdf exportado.',
  'store.imagesExported': '{count} imagens exportadas em .zip.',
  'store.imageExported': '{name}.{format} exportado.',
  'store.docxExported': '{name}.docx exportado com {count} parágrafos de texto{imageNote}.',
  'store.docxExportedNoText': '{name}.docx exportado, mas nenhum texto foi encontrado no PDF.',
  'store.andImages': ' e {count} imagem(ns)',
  'store.fontCaptured': 'Fonte capturada: {font}',

  // ---- file loading errors ----
  'loader.imageReadError': 'Não foi possível ler a imagem.',
  'loader.fileTooLarge': '"{name}" tem {size}. O limite é 50MB.',
  'loader.pdfOpenError': 'Não foi possível abrir "{name}": {detail}',

  // ---- docx export ----
  'export.docxNoExtractableText': '[Página {n} não contém texto extraível]',
} as const;

export type TranslationKey = keyof typeof pt;

const en: Record<TranslationKey, string> = {
  // ---- home / empty state ----
  'home.pageTitle': 'Fluva — Free online PDF and image editor',
  'home.dropzoneTitle': 'Drag your files here or click to browse',
  'home.dropzoneSub': 'PDF · PNG · JPG — up to 50MB per file',
  'home.dismiss': 'Dismiss',
  'home.remove': 'Remove {name}',
  'home.edit': 'Edit',
  'home.changeFormat': 'Change format',
  'home.convertAllTo': 'Convert all to',
  'home.cancel': 'Cancel',
  'home.convertAndDownload': 'Convert and download',

  // ---- beta / "test the app" screen ----
  'beta.title': 'Try our app!',
  'beta.body':
    'Get Fluva on your own phone by signing up for an early test version. Just send an email to {email} saying you want in, and I\'ll open access to the app version right away.',
  'beta.back': 'Back',

  // ---- top bar ----
  'topbar.renameTitle': 'Rename file',
  'topbar.renameAria': 'File name for export',
  'topbar.page': '{count} page',
  'topbar.pages': '{count} pages',
  'topbar.backHome': 'Back to home',
  'topbar.testApp': 'Try our app',
  'topbar.donate': 'Donate to Fluva',
  'topbar.donateTitle': 'Help keep Fluva online',
  'topbar.donateMessage':
    "Fluva is completely free — I keep the site online and available to everyone with my own resources. If you'd like to help out, you can make a donation via Pix (Brazil) to 142.353.286-46, any amount welcome. Thank you so much for wanting to support the project!",
  'topbar.donateQrAlt': 'Pix QR code for donations',
  'topbar.export': 'Export',
  'topbar.close': 'Close',
  'topbar.lang': 'Language',

  // ---- export dropdown ----
  'export.asPdf': 'Export as PDF',
  'export.asImageHeading': 'Export as image',
  'export.asPng': 'Export as PNG',
  'export.asJpg': 'Export as JPG',
  'export.orAsDocument': 'or export as document',
  'export.orConvertTo': 'or convert to',
  'export.word': 'Word (.docx)',
  'export.beta': 'BETA',

  // ---- toolbar ----
  'toolbar.edit': 'Edit',
  'toolbar.merge': 'Merge PDFs',
  'toolbar.split': 'Split PDF',
  'toolbar.compress': 'Compress',
  'toolbar.rotate': 'Rotate',
  'toolbar.rotateTitle': 'Rotate page',
  'toolbar.watermark': 'Watermark',
  'toolbar.reorder': 'Reorder',
  'toolbar.undo': 'Undo (Ctrl+Z)',
  'toolbar.redo': 'Redo (Ctrl+Shift+Z)',
  'toolbar.zoomAria': 'Page zoom',
  'toolbar.zoomTitle': 'Zoom: {pct}%',

  // ---- thumbnail rail ----
  'rail.pageLabel': 'p. {n}',
  'rail.pageAria': 'Page {n}',
  'rail.deletePageAria': 'Delete page {n}',
  'rail.addBlankPage': 'Add blank page',
  'rail.mergeFilesLabel': 'Files to merge',
  'rail.noOtherPdf': 'No other PDF loaded yet.',
  'rail.addPdfs': 'Add PDFs',

  // ---- right panel: "Add" ----
  'panel.addToPage': 'Add to page {n}',
  'panel.addText': 'Add text',
  'panel.captureFontActive': 'Click any text on the site (Esc to cancel)',
  'panel.captureFontCaptured': 'Font captured — click to capture another',
  'panel.captureFontIdle': 'Pick up a font from existing text',
  'panel.addImage': 'Add image',
  'panel.addShape': 'Add shape',
  'panel.rotatePage': 'Rotate page 90°',
  'panel.deletePage': 'Delete page',
  'panel.clickToReplace': 'Click a piece of text on the page to replace it.',
  'panel.movingTextTitle': 'Moving text',
  'panel.movingTextNote': 'Click anywhere on the text on the page and drag to reposition it. Press Enter or click Ok when done.',
  'panel.ok': 'Ok',

  // ---- overlay panel (text / image / shape / cover) ----
  'overlay.textTitle': 'Text',
  'overlay.content': 'Content',
  'overlay.font': 'Font',
  'overlay.size': 'Size',
  'overlay.color': 'Color',
  'overlay.rotation': 'Rotation: {deg}°',
  'overlay.moveText': 'Move text',
  'overlay.removeText': 'Remove text',
  'overlay.imageTitle': 'Image',
  'overlay.imageNote': 'Drag on the page to move it, or use the corner handle to resize.',
  'overlay.rotate90': 'Rotate 90°',
  'overlay.removeImage': 'Remove image',
  'overlay.shapeTitle': 'Shape',
  'overlay.confirmPlacement': 'Confirm placement',
  'overlay.shapeFormat': 'Shape',
  'overlay.rectangle': 'Rectangle',
  'overlay.circle': 'Circle',
  'overlay.removeShape': 'Remove shape',
  'overlay.coverTitle': 'Cover',
  'overlay.coverNote': 'Rectangle covering the replaced original text.',
  'overlay.removeCover': 'Remove cover',
  'overlay.pickColorTitle': 'Pick a color (RGB)',
  'overlay.pickScreenColor': 'Pick color from screen',
  'overlay.colorAria': 'Color {hex}',
  'overlay.width': 'W',
  'overlay.height': 'H',

  // ---- text run panel (replacing original PDF text) ----
  'run.title': 'Replace text',
  'run.text': 'Text',
  'run.originalFont': 'Original font',
  'run.exactMatch': 'substitute with identical metrics',
  'run.approxMatch': 'approximate substitute',
  'run.substituteFont': 'Substitute font',
  'run.inPlaceOf': ' — in place of {names}',
  'run.applyFontToDoc': 'Apply this font to the whole document',
  'run.applyFontTitle':
    "Looks through every page for other text in the same original font and applies this same substitute to all of it, keeping each one's own bold/italic and colors",
  'run.replaceText': 'Replace text',
  'run.moveText': 'Move text',
  'run.moveTextTitle': 'Detaches the text from the original PDF so you can drag it freely around the page',
  'run.cancel': 'Cancel',
  'run.moveHandleTitle': 'Hold and drag to move',
  'run.moveHandleAria': 'Move text',
  'run.detectedRun': '{font} · {size}pt — click to replace',

  // ---- merge panel ----
  'merge.title': 'Merge PDFs',
  'merge.note': 'Check the files to merge in the left-hand column. Here you set the order their pages join onto the end of the current document.',
  'merge.noneSelected': 'No file selected.',
  'merge.order': 'Merge order',
  'merge.removeAria': 'Remove {name}',
  'merge.confirm': 'Merge {count} file(s) · +{pages} pages',
  'merge.pages': '{count} pg.',

  // ---- compress panel ----
  'compress.title': 'Compress',
  'compress.intensity': 'Intensity',
  'compress.levelLow': 'Light',
  'compress.levelMedium': 'Balanced',
  'compress.levelHigh': 'Maximum',
  'compress.note':
    "Scanned documents or image-heavy files get re-encoded as images, which cuts the size a lot. Files whose text is already optimized are kept as-is, with no quality loss.",
  'compress.runNow': 'Compress now',
  'compress.before': 'Before',
  'compress.after': 'After',
  'compress.reduced': '−{pct}% in size',
  'compress.alreadyMin': 'This file is already at its smallest possible size.',
  'compress.rasterNote': 'The pages became images, so the text is no longer selectable.',
  'compress.rebuildNote': 'Re-encoding as images would have made the file bigger, so the document was kept with selectable text.',
  'compress.downloadPdf': 'Download PDF',

  // ---- watermark panel ----
  'wm.title': 'Watermark',
  'wm.active': 'Watermark active',
  'wm.activate': 'Enable watermark',
  'wm.text': 'Text',
  'wm.image': 'Image',
  'wm.imageLoaded': 'Image loaded',
  'wm.swapImage': 'Swap image',
  'wm.allPages': 'On every page',
  'wm.onlySelected': 'Only the selected page',
  'wm.posH': 'Horizontal position',
  'wm.posV': 'Vertical position',
  'wm.scale': 'Size',
  'wm.rotation': 'Rotation',
  'wm.remove': 'Remove watermark',

  // ---- reorder panel + preview ----
  'reorder.title': 'Reorder pages',
  'reorder.note': 'Drag pages in the center area or in the left-hand column to reorder the document.',
  'reorder.previewNote': 'Drag a page and drop it onto another to reorder the document.',
  'reorder.pageLabel': 'p. {n}',

  // ---- split panel + preview ----
  'split.title': 'Split PDF',
  'split.range': 'Range',
  'split.pages': 'Pages',
  'split.autoInterval': 'Automatic split',
  'split.chooseInterval': 'Choose ranges',
  'split.howManyParts': 'Split into how many parts?',
  'split.autoNote': 'The {total} pages will be split into {parts} file(s), as evenly as possible.',
  'split.intervals': 'Ranges',
  'split.noIntervals': 'No range added yet.',
  'split.from': 'from',
  'split.to': 'to',
  'split.removeIntervalAria': 'Remove range {n}',
  'split.addInterval': 'Add range',
  'split.divide': 'Split',
  'split.extractAll': 'Extract all',
  'split.selectPages': 'Select pages',
  'split.eachPageNote': 'Each of the {total} pages becomes its own PDF, delivered in a .zip.',
  'split.clickToSelect': 'Click pages in the center area to select them.',
  'split.mergeSelected': 'Merge selected pages into a single PDF',
  'split.selectedCount': '{count} page(s) selected.',
  'split.extractCount': 'Extract {count} files',
  'split.extractSelected': 'Extract selected',
  'split.previewTitle': 'Split preview',
  'split.mergedLabel': 'merged',
  'split.ownFileLabel': 'own file',
  'split.file': 'File {n}',
  'split.interval': 'Range {n}',
  'split.outcomeAuto': '{total} page(s) split into {parts} file(s): {sizes} page(s).',
  'split.outcomeCustomEmpty': 'Add a range in the panel on the right to see the split here.',
  'split.outcomeCustom': '{count} range(s) defined, producing {count} file(s). Pages outside every range are left out.',
  'split.outcomeAll': 'Each of the {total} pages becomes its own PDF, delivered in a .zip.',
  'split.outcomeSelectEmpty': 'Click pages below to select them.',
  'split.outcomeSelectMerge': '{count} selected page(s) will be merged into a single PDF.',
  'split.outcomeSelectSeparate': '{count} selected page(s) become {count} separate PDF(s).',

  // ---- footer ----
  'footer.tagline': 'PDF and image editor',

  // ---- unsaved-changes / navigation ----
  'nav.unsavedChanges': 'You have unexported changes in this document. Going back will lose them. Continue?',

  // ---- toasts / busy labels / errors from the store ----
  'store.genericError': 'Something went wrong.',
  'store.rejectedFormat': '{name} (unsupported format)',
  'store.rejectedSize': '{name} ({size}, over 50MB)',
  'store.ignored': 'Ignored: {list}',
  'store.openingFiles': 'Opening files…',
  'store.filesJoined': '{count} files merged into a single document.',
  'store.convertingTo': 'Converting to {format}…',
  'store.filesConverted': '{count} file(s) converted to {format}.',
  'store.newText': 'New text',
  'store.insertingImage': 'Inserting image…',
  'store.applying': 'Applying…',
  'store.findingFont': 'Searching the document for this font…',
  'store.fontNotIdentified': "Couldn't identify that font.",
  'store.noOtherFontFound': 'No other text with that font was found in the document.',
  'store.textsUpdated': '{count} text(s) updated to {font}.',
  'store.loadingWatermark': 'Loading watermark…',
  'store.loadingPdfs': 'Loading PDFs…',
  'store.filesJoinedCount': '{count} file(s) merged — {pages} pages added.',
  'store.dividing': 'Splitting…',
  'store.addAtLeastOneInterval': 'Add at least one range.',
  'store.dividedInto': 'Split into {count} file(s).',
  'store.selectAtLeastOnePage': 'Select at least one page.',
  'store.pdfsPerPage': '{count} PDFs generated, one per page.',
  'store.pagesMergedIntoOne': 'Selected pages merged into one PDF.',
  'store.pdfsFromSelection': '{count} PDFs generated from the selected pages.',
  'store.compressing': 'Compressing…',
  'store.exporting': 'Exporting…',
  'store.pdfExported': '{name}.pdf exported.',
  'store.imagesExported': '{count} images exported as .zip.',
  'store.imageExported': '{name}.{format} exported.',
  'store.docxExported': '{name}.docx exported with {count} paragraphs of text{imageNote}.',
  'store.docxExportedNoText': '{name}.docx exported, but no text was found in the PDF.',
  'store.andImages': ' and {count} image(s)',
  'store.fontCaptured': 'Font captured: {font}',

  // ---- file loading errors ----
  'loader.imageReadError': "Couldn't read the image.",
  'loader.fileTooLarge': '"{name}" is {size}. The limit is 50MB.',
  'loader.pdfOpenError': 'Could not open "{name}": {detail}',

  // ---- docx export ----
  'export.docxNoExtractableText': '[Page {n} contains no extractable text]',
};

const dictionaries: Record<Lang, Record<TranslationKey, string>> = { pt, en };

/** Browser locale first, defaulting to Portuguese since that's the app's primary audience. */
function detectLang(): Lang {
  if (typeof navigator === 'undefined') return 'pt';
  return navigator.language.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

const STORAGE_KEY = 'fluva-lang';

function loadStoredLang(): Lang | null {
  if (typeof localStorage === 'undefined') return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'pt' || stored === 'en' ? stored : null;
}

// A module-level mirror of the current language, not just React state — so
// plain functions outside any component (the pdf/ pipeline's toasts and
// thrown errors) can call `t()` too, without every one of them needing
// `lang` threaded through its signature just to phrase a message.
let currentLang: Lang = loadStoredLang() ?? detectLang();

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  currentLang = lang;
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, lang);
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
}

/** Translates `key` in the current language, filling in any `{name}` placeholders from `vars`. */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  const template = dictionaries[currentLang][key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}
