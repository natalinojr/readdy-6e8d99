const { execSync } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function log(message) {
  console.log(message);
}

function errorAndExit(message) {
  console.log(`\n[ERRO] ${message}`);
  rl.question('\nPressione Enter para sair... ', () => {
    process.exit(1);
  });
}

function successAndExit() {
  rl.question('\nPressione Enter para sair... ', () => {
    process.exit(0);
  });
}

async function main() {
  log('============================================');
  log('   ERPOS - Instalador do Agente de Impressao');
  log('============================================\n');

  // Verifica Node.js
  let nodeVersion;
  try {
    nodeVersion = execSync('node --version', { encoding: 'utf-8' }).trim();
    log(`[OK] Node.js detectado: ${nodeVersion}\n`);
  } catch {
    log('[ERRO] Node.js nao encontrado!\n');
    log('Para instalar o agente, voce precisa do Node.js.\n');
    log('1. Acesse: https://nodejs.org/');
    log('2. Baixe a versao LTS (recomendado)');
    log('3. Instale com as opcoes padrao');
    log('4. Execute este arquivo novamente\n');
    errorAndExit('Node.js nao esta instalado');
    return;
  }

  // Instala dependencias
  log('[1/3] Instalando dependencias...');
  try {
    execSync('npm install', { stdio: 'inherit' });
    log('[OK] Dependencias instaladas.\n');
  } catch {
    errorAndExit('Falha ao instalar dependencias.');
    return;
  }

  // Instala servico
  log('[2/3] Registrando servico do Windows...');
  log('   (Isso permite que o agente inicie automaticamente)\n');
  try {
    execSync('node service-install.js', { stdio: 'inherit' });
  } catch {
    errorAndExit('Falha ao registrar o servico.');
    return;
  }

  log('\n============================================');
  log('   INSTALACAO CONCLUIDA!');
  log('============================================\n');
  log('O agente de impressao esta rodando em:');
  log('   http://localhost:9876\n');
  log('Ele iniciara automaticamente junto com o Windows.\n');
  log('Para testar, abra o navegador e acesse:');
  log('   http://localhost:9876/health\n');
  log('Para desinstalar, execute:');
  log('   node service-uninstall.js\n');
  successAndExit();
}

main();