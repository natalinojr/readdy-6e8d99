const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'ERPOS Print Agent',
  script: path.join(__dirname, 'index.js'),
});

svc.on('uninstall', () => {
  console.log('[ERPOS] Servico removido com sucesso.');
});

svc.on('error', (err) => {
  console.error('[ERPOS] Erro ao remover:', err.message);
});

svc.uninstall();