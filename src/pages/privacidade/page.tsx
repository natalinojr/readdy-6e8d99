import { ChefHat } from 'lucide-react';

/**
 * Política de Privacidade — página PÚBLICA (sem login).
 * Exigida pela Meta para apps que usam Login do Facebook.
 * Rota: /privacidade
 */
export default function PrivacidadePage() {
  return (
    <div className="min-h-screen bg-neutral-50 text-zinc-800">
      <div className="max-w-3xl mx-auto px-5 py-12">
        {/* Cabeçalho */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-amber-500">
            <ChefHat size={20} className="text-white" />
          </div>
          <div>
            <p className="font-black text-lg tracking-wide leading-none">ERPOS</p>
            <p className="text-amber-600 text-xs font-semibold">Política de Privacidade</p>
          </div>
        </div>

        <h1 className="text-2xl font-black mb-2">Política de Privacidade</h1>
        <p className="text-sm text-zinc-500 mb-8">Última atualização: junho de 2026</p>

        <div className="space-y-6 text-sm leading-relaxed text-zinc-600">
          <section>
            <h2 className="text-base font-bold text-zinc-800 mb-2">1. Quem somos</h2>
            <p>
              O ERPOS é um sistema de gestão para estabelecimentos (PDV, cardápio, pedidos,
              relatórios e integrações). Esta política descreve como tratamos os dados quando
              você conecta sua conta de anúncios da Meta (Facebook/Instagram) ao sistema.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-zinc-800 mb-2">2. Quais dados acessamos</h2>
            <p>
              Ao usar o recurso de <strong>Tráfego Pago</strong>, com a sua autorização explícita
              via Login do Facebook, acessamos apenas dados de <strong>desempenho das suas
              campanhas de anúncios</strong> (permissão <code>ads_read</code>): gasto, alcance,
              impressões, cliques, custo por clique e resultados. Não acessamos mensagens,
              contatos, publicações nem dados pessoais de terceiros.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-zinc-800 mb-2">3. Como usamos</h2>
            <p>
              Esses dados são usados exclusivamente para <strong>exibir os números das suas
              campanhas dentro do seu painel no ERPOS</strong>, ajudando você a acompanhar o
              investimento em anúncios. Não vendemos nem compartilhamos esses dados com terceiros.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-zinc-800 mb-2">4. Armazenamento e segurança</h2>
            <p>
              O token de acesso fornecido pela Meta é armazenado de forma segura no nosso
              servidor (Supabase), acessível somente pelo backend do sistema — nunca exposto ao
              navegador ou a outros usuários. Cada loja só tem acesso aos próprios dados.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-zinc-800 mb-2">5. Como desconectar e excluir seus dados</h2>
            <p>
              Você pode desconectar sua conta da Meta a qualquer momento pelo botão
              <strong> “Desconectar”</strong> na tela de Tráfego Pago do ERPOS — isso remove
              imediatamente o token e os dados de conexão do nosso servidor. Você também pode
              revogar o acesso diretamente nas configurações da sua conta do Facebook, em
              “Aplicativos e sites”.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-zinc-800 mb-2">6. Contato</h2>
            <p>
              Para dúvidas sobre esta política ou sobre seus dados, entre em contato pelo e-mail:{' '}
              <a href="mailto:natalinojr.engel@gmail.com" className="text-amber-600 font-semibold">
                natalinojr.engel@gmail.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
