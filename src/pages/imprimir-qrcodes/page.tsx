import { useState, useEffect, useMemo, useCallback } from 'react';
import QRCodeImport from 'react-qr-code';
const QRCode = ((QRCodeImport as unknown as { default: typeof QRCodeImport }).default || QRCodeImport) as typeof QRCodeImport;
import { useTablesConfig, type MesaConfig } from '../../hooks/useTablesConfig';
import { useSystemSettings, type SectorConfig } from '../../hooks/useSystemSettings';
import { getAppBaseUrl } from '../../lib/appUrl';

function getMesaUrl(mesa: MesaConfig): string {
  const token = mesa.qrCode || mesa.numero;
  return `${getAppBaseUrl()}/mesa-qr/${token}`;
}

export default function ImprimirQRCodesPage() {
  const { mesas, loading } = useTablesConfig();
  const { settings } = useSystemSettings();
  const [setores, setSetores] = useState<SectorConfig[]>([]);

  useEffect(() => {
    if (settings.sectors_config && settings.sectors_config.length > 0) {
      setSetores(settings.sectors_config);
    }
  }, [settings.sectors_config]);

  const getSetorCor = useCallback(
    (nome: string) => setores.find((s) => s.nome === nome)?.cor ?? '#71717a',
    [setores],
  );

  const mesasPorSetor = useMemo(() => {
    const map: Record<string, MesaConfig[]> = {};
    const ordenadas = [...mesas].sort((a, b) => a.numero - b.numero);
    ordenadas.forEach((m) => {
      if (!map[m.setor]) map[m.setor] = [];
      map[m.setor].push(m);
    });
    return map;
  }, [mesas]);

  const handlePrint = () => window.print();

  const nomeLoja = 'Meu Restaurante';
  const dataHoje = new Date().toLocaleDateString('pt-BR');

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-zinc-500 font-medium">Carregando QR Codes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white print:bg-white">
      {/* Barra de ações - some na impressão */}
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-zinc-200 px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-bold text-zinc-900">QR Codes das Mesas</h1>
          <p className="text-xs text-zinc-400">{mesas.length} mesas · Layout de impressão</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.close()}
            className="px-4 py-2 text-xs font-semibold text-zinc-600 bg-zinc-100 rounded-lg hover:bg-zinc-200 cursor-pointer whitespace-nowrap transition-colors"
          >
            Voltar
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-printer-line" />
            Imprimir (Ctrl+P)
          </button>
        </div>
      </div>

      {/* Conteúdo de impressão */}
      <div className="p-6 print:p-0">
        {/* Cabeçalho da impressão */}
        <div className="hidden print:block text-center mb-8">
          <h1 className="text-2xl font-black text-zinc-900">{nomeLoja}</h1>
          <p className="text-sm text-zinc-500 mt-1">QR Codes das Mesas — {dataHoje}</p>
          <div className="mt-3 border-b-2 border-zinc-900 w-32 mx-auto" />
        </div>

        {/* Aviso antes de imprimir */}
        <div className="print:hidden mb-6 flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <i className="ri-information-line text-amber-500 flex-shrink-0" />
          <p className="text-xs text-amber-800">
            <strong>Pronto para imprimir.</strong> Clique em &ldquo;Imprimir&rdquo; ou pressione Ctrl+P.
            Os QR codes usam correção de erro nível H — o número central não impede a leitura.
          </p>
        </div>

        {/* QR Codes agrupados por setor */}
        {Object.entries(mesasPorSetor).map(([setor, mesasDoSetor]) => (
          <div key={setor} className="mb-10 print:mb-6">
            {/* Título do setor */}
            <div className="flex items-center gap-2 mb-4 print:mb-3">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: getSetorCor(setor) }}
              />
              <h2 className="text-sm font-bold text-zinc-800 print:text-base">
                {setor}
                <span className="ml-2 text-xs font-normal text-zinc-400">
                  ({mesasDoSetor.length} mesa{mesasDoSetor.length !== 1 ? 's' : ''})
                </span>
              </h2>
            </div>

            {/* Grid de QR Codes */}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 print:grid-cols-4 gap-4 print:gap-3">
              {mesasDoSetor.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-col items-center p-3 rounded-xl border border-zinc-200 bg-zinc-50/50 print:border-zinc-300 print:bg-white"
                >
                  <div className="relative inline-block mb-2 w-[100px] h-[100px] print:w-[90px] print:h-[90px]">
                    <QRCode
                      value={getMesaUrl(m)}
                      size={100}
                      level="H"
                      bgColor="#ffffff"
                      fgColor="#09090b"
                      style={{ display: 'block', width: '100%', height: '100%' }}
                    />
                    {/* Número da mesa no centro */}
                    <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                      <div className="bg-white rounded-full w-9 h-9 print:w-8 print:h-8 flex items-center justify-center border-[2.5px] border-zinc-900">
                        <span className="text-sm print:text-xs font-black text-zinc-900 leading-none">
                          {m.numero}
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs font-bold text-zinc-700">Mesa {m.numero}</p>
                  <p className="text-[10px] text-zinc-400">{m.capacidade} pax</p>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Rodapé da impressão */}
        <div className="hidden print:block text-center mt-8 pt-4 border-t border-zinc-200">
          <p className="text-xs text-zinc-400">
            Total: {mesas.length} mesas · Gerado em {dataHoje}
          </p>
        </div>

        {/* Mensagem para os clientes */}
        <div className="mt-8 print:mt-6 text-center px-6 py-5 bg-amber-50 border border-amber-200 rounded-xl print:bg-amber-50 print:border print:border-amber-300 print:rounded-lg">
          <div className="flex items-center justify-center gap-2 mb-1.5">
            <div className="w-6 h-6 flex items-center justify-center">
              <i className="ri-qr-scan-line text-amber-500 text-lg" />
            </div>
            <p className="text-sm font-bold text-amber-800 print:text-sm">
              Não precisa se levantar e nem esperar,
            </p>
          </div>
          <p className="text-sm font-bold text-amber-800 print:text-sm">
            leia o QR CODE e faça já seu pedido!
          </p>
        </div>
      </div>

      {/* Mensagem quando não há mesas */}
      {mesas.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
            <i className="ri-qr-code-line text-zinc-300 text-2xl" />
          </div>
          <p className="text-sm font-semibold text-zinc-500">Nenhuma mesa cadastrada</p>
          <p className="text-xs text-zinc-400 mt-1">Cadastre mesas nas configurações para gerar QR Codes.</p>
        </div>
      )}
    </div>
  );
}