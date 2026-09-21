const Service = require('node-windows').Service;
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const svc = new Service({
  name: 'ERPOS Print Agent',
  description: 'Agente local de impressao do ERPOS. Recebe pedidos via localhost:9876 e envia para impressora de rede.',
  script: path.join(__dirname, 'index.js'),
  nodeOptions: ['--harmony', '--max_old_space_size=256'],
});

// O node-windows decide se o servico existe olhando SO se os arquivos
// daemon\<id>.exe e daemon\<id>.xml estao na pasta (lib/daemon.js, getter
// `exists`) — ele nunca pergunta ao Windows. Uma instalacao que falhou no
// meio (sem administrador, ou com o nome do servico ocupado por uma copia
// antiga do agente) deixa esses arquivos para tras; a partir dai toda
// reinstalacao vira um no-op silencioso: imprime "ja estava instalado" e
// "servico iniciado", sem nunca registrar nada. Vivido em Paranagua
// (21/09/2026): o agente so subia com uma janela de `node index.js` aberta.
// Por isso conferimos a verdade no proprio Windows antes de instalar.
function servicoRegistradoNoWindows() {
  for (const nome of [svc.id, `${svc.id}.exe`]) {
    try {
      execSync(`sc.exe query "${nome}"`, { stdio: 'ignore' });
      return true;
    } catch (_) {
      // sc.exe sai com erro quando o servico nao existe — segue tentando
    }
  }
  return false;
}

function ehAdministrador() {
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

if (!ehAdministrador()) {
  console.error('[ERPOS] Esta janela NAO esta como administrador.');
  console.error('[ERPOS] Sem isso o Windows recusa registrar o servico (Erro 5 / Acesso negado).');
  console.error('[ERPOS] Feche e abra de novo: tecla Win+X > "Terminal (Administrador)".');
  process.exit(1);
}

const daemonDir = path.join(__dirname, 'daemon');
if (fs.existsSync(daemonDir) && !servicoRegistradoNoWindows()) {
  console.log('[ERPOS] Sobras de uma instalacao anterior encontradas em daemon\\ (o Windows nao');
  console.log('[ERPOS] conhece este servico). Limpando para instalar de verdade...');
  try {
    fs.rmSync(daemonDir, { recursive: true, force: true });
  } catch (err) {
    console.error('[ERPOS] Nao consegui apagar a pasta daemon\\:', err.message);
    console.error('[ERPOS] Apague-a na mao e rode este comando de novo.');
    process.exit(1);
  }
}

svc.on('install', () => {
  console.log('[ERPOS] Servico instalado com sucesso!');
  console.log('[ERPOS] Iniciando servico...');
  svc.start();
});

svc.on('alreadyinstalled', () => {
  console.log('[ERPOS] Servico ja estava instalado no Windows. Iniciando...');
  svc.start();
});

svc.on('start', () => {
  console.log('[ERPOS] Servico iniciado! O agente esta rodando em http://localhost:9876');
  console.log('[ERPOS] Confirme abrindo http://localhost:9876/health com esta janela fechada.');
});

svc.on('error', (err) => {
  console.error('[ERPOS] Erro:', err.message);
});

svc.install();
