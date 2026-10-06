import { useNavigate } from 'react-router-dom';
import { usePermissoes, RECEBER_MODULO_KEYS } from '@/hooks/usePermissoes';
import { sairDasCamadas } from '@/lib/voltarAndroid';
import Folha from '../inicio/Folha';
import { useEstoqueTela } from '../../EstoqueTela';

// "+ Registrar" (layout novo): "o que aconteceu no estoque?". Oito respostas, cada uma leva ao lugar
// certo; os caminhos de antes (abas, botões da lista) continuam existindo. Fecha esta folha antes de
// abrir o destino.
type Cor = 'verde' | 'vermelho' | 'azul' | 'ambar';
const COR_ICONE: Record<Cor, string> = {
  verde: 'text-emerald-600', vermelho: 'text-red-600', azul: 'text-blue-600', ambar: 'text-amber-600',
};

interface Resposta { icone: string; titulo: string; linha: string; cor: Cor; ir: () => void; bloqueada?: boolean }

export default function RegistrarFolha({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
  const navigate = useNavigate();
  const { hasPermissao } = usePermissoes();
  const tela = useEstoqueTela();
  const podeReceber = RECEBER_MODULO_KEYS.some((k) => hasPermissao(k));

  // Fecha a folha e só então abre o destino (a pilha do botão voltar se acerta sozinha).
  const depois = (acao: () => void) => () => { onFechar(); acao(); };

  const respostas: Resposta[] = [
    { icone: 'ri-truck-line', titulo: 'Chegou mercadoria', cor: 'verde', bloqueada: !podeReceber,
      linha: podeReceber ? 'com ou sem nota · leva ao Receber' : 'quem recebe a mercadoria dá a entrada',
      // Sai de outra tela: tira antes a entrada que esta folha pôs no histórico (senão o voltar para nela).
      ir: () => { onFechar(); sairDasCamadas(() => navigate('/receber')); } },
    { icone: 'ri-delete-bin-6-line', titulo: 'Estragou / joguei fora', linha: 'perda', cor: 'vermelho', ir: depois(() => tela.abrirPerda()) },
    { icone: 'ri-arrow-up-line', titulo: 'Usei fora da venda', linha: 'equipe, cortesia, teste', cor: 'ambar', ir: depois(() => tela.abrirSaida()) },
    { icone: 'ri-knife-line', titulo: 'Produzi na cozinha', linha: 'guacamole, cheddar…', cor: 'ambar', ir: depois(() => tela.irPara('producao')) },
    { icone: 'ri-scales-3-line', titulo: 'Contei', linha: 'alguns ou tudo', cor: 'azul', ir: depois(() => tela.irPara('inventario')) },
    // Empréstimo entre lojas: sai daqui e só entra na outra quando ela conferir (/receber/emprestimos)
    { icone: 'ri-store-2-line', titulo: 'Mandei para outra loja', linha: 'empréstimo · a outra loja confere', cor: 'ambar',
      ir: () => { onFechar(); sairDasCamadas(() => navigate('/receber/emprestimos?mandar=1')); } },
    { icone: 'ri-arrow-left-down-line', titulo: 'Chegou de outra loja', linha: podeReceber ? 'empréstimo · digitar o que chegou' : 'quem recebe a mercadoria confere', cor: 'verde', bloqueada: !podeReceber,
      ir: () => { onFechar(); sairDasCamadas(() => navigate('/receber/emprestimos?receber=1')); } },
    { icone: 'ri-shopping-basket-line', titulo: 'Comprei no mercado', linha: 'cupom, Pix na hora', cor: 'ambar', ir: depois(() => tela.abrirCompra()) },
    { icone: 'ri-add-box-line', titulo: 'Insumo novo', linha: 'cadastrar', cor: 'ambar', ir: depois(() => tela.abrirNovoInsumo()) },
  ];

  return (
    <Folha aberta={aberta} titulo="O que aconteceu no estoque?" subtitulo="Escolha e o app leva para o lugar certo" onFechar={onFechar}>
      <div className="grid grid-cols-2 gap-2 pt-1 pb-3">
        {respostas.map((r) => (
          <button key={r.titulo} type="button" onClick={r.ir} disabled={r.bloqueada}
            className="min-h-[92px] flex flex-col gap-0.5 text-left bg-white border border-zinc-200 rounded-2xl p-3 cursor-pointer hover:border-amber-300 active:bg-amber-50/40 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-zinc-200">
            <i className={`${r.icone} text-[21px] mb-0.5 ${COR_ICONE[r.cor]}`} />
            <b className="text-[13.5px] font-extrabold text-zinc-900 leading-tight">{r.titulo}</b>
            <span className="text-[11px] text-zinc-400 leading-snug">{r.linha}</span>
          </button>
        ))}
      </div>
    </Folha>
  );
}
