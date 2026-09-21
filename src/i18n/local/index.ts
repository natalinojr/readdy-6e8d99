const modules = import.meta.glob('./*/*.ts', { eager: true });

const messages: Record<string, { translation: Record<string, string> }> = {};

Object.keys(modules).forEach((path) => {
  const match = path.match(/\.\/([^/]+)\/([^/]+)\.ts$/);
  if (match) {
    const [, lang] = match;
    const module = modules[path] as { default?: Record<string, string> };
    
    if (!messages[lang]) {
      messages[lang] = { translation: {} };
    }
    
    // 合并翻译内容
    if (module.default) {
      messages[lang].translation = {
        ...messages[lang].translation,
        ...module.default
      };
    }
  }
});

// Alias 'pt' -> 'pt-BR'. O i18next resolve 'pt-BR' descendo para a base 'pt'
// quando ha `supportedLngs`; sem esta linha o portugues caia no fallback e a
// tela mostrava a CHAVE crua ("cliente.buscar") em vez do texto.
if (messages['pt-BR'] && !messages['pt']) {
  messages['pt'] = messages['pt-BR'];
}

export default messages; 