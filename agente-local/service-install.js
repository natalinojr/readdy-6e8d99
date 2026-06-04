const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'ERPOS Print Agent',
  description: 'Agente local de impressao do ERPOS. Recebe pedidos via localhost:9876 e envia para impressora de rede.',
  script: path.join(__dirname, 'index.js'),
  nodeOptions: ['--harmony', '--max_old_space_size=256'],
});

svc.on('install', () => {
  console.log('[ERPOS] Servico instalado com sucesso!');
  console.log('[ERPOS] Iniciando servico...');
  svc.start();
});

svc.on('alreadyinstalled', () => {
  console.log('[ERPOS] Servico ja estava instalado. Iniciando...');
  svc.start();
});

svc.on('start', () => {
  console.log('[ERPOS] Servico iniciado! O agente esta rodando em http://localhost:9876');
  console.log('[ERPOS] Voce pode fechar esta janela.');
});

svc.on('error', (err) => {
  console.error('[ERPOS] Erro:', err.message);
});

svc.install();