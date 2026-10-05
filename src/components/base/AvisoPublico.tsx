// Tela simples para endereço público aposentado (QR antigo, convite antigo). Sem menu, sem botão:
// quem chega aqui não está logado e não tem para onde "voltar" — só precisa saber o que pedir. (2026-10-05)
export default function AvisoPublico({ icone, titulo, children }: { icone: string; titulo: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[#FAF7F2]">
      <div className="bg-white border border-zinc-200 rounded-2xl px-6 py-8 text-center w-full max-w-sm">
        <span className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-500 inline-flex items-center justify-center mb-3">
          <i className={`${icone} text-2xl`} />
        </span>
        <h1 className="text-base font-extrabold text-zinc-800">{titulo}</h1>
        <p className="text-sm text-zinc-500 mt-1.5 leading-relaxed">{children}</p>
      </div>
    </div>
  );
}
