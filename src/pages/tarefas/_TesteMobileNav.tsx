import { useState } from 'react';
import { BottomNav, ListasSheet } from './components/MobileNav';

const LISTAS_FAKE = [
  { id: '1', name: 'Abertura da loja', color: '#6366f1', icon: null, sort_order: 0, statuses: [], open_count: 3 },
  { id: '2', name: 'Manutenção', color: '#ef4444', icon: null, sort_order: 1, statuses: [], open_count: 0 },
];

export default function TesteMobileNav() {
  const [aberto, setAberto] = useState(true);
  const [log, setLog] = useState<string[]>([]);
  const registrar = (msg: string) => setLog((l) => [msg, ...l]);

  return (
    <div style={{ maxWidth: 400, margin: '0 auto', position: 'relative', height: '100vh', border: '1px solid #ccc' }}>
      <div style={{ padding: 16 }}>
        <h3>Teste isolado: MobileNav</h3>
        <button onClick={() => setAberto(true)}>Abrir folha de Listas</button>
        <ul>{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </div>
      <BottomNav view="minhas" onView={() => registrar('onView')} onAbrirListas={() => setAberto(true)} pendencias={2} />
      {aberto && (
        <ListasSheet
          lists={LISTAS_FAKE as any}
          selectedId="1"
          onSelecionar={(id) => registrar('selecionou ' + id)}
          onNovaLista={() => registrar('nova lista')}
          onCampos={() => registrar('CAMPOS PERSONALIZADOS clicado')}
          onTemplates={() => registrar('TEMPLATES clicado')}
          onClose={() => setAberto(false)}
        />
      )}
    </div>
  );
}
