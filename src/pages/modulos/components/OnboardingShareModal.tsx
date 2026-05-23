import { useState } from 'react';
import { X, Link2, Check, MessageCircle, Mail, ExternalLink } from 'lucide-react';
import { getOnboardingUrl } from '@/lib/appUrl';

interface OnboardingShareModalProps {
  onClose: () => void;
}

export default function OnboardingShareModal({ onClose }: OnboardingShareModalProps) {
  const [copied, setCopied] = useState(false);

  const url = getOnboardingUrl();

  const mensagem =
    `Olá! Você foi convidado para configurar seu restaurante no ERPOS V2.\n\n` +
    `Acesse o link abaixo para começar o processo de configuração:\n${url}\n\n` +
    `Siga o assistente de configuração para criar sua conta e configurar sua loja.`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleWhatsApp = () => {
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(mensagem)}`, '_blank');
  };

  const handleEmail = () => {
    const subject = encodeURIComponent('Convite — Configure sua loja no ERPOS V2');
    const body = encodeURIComponent(mensagem);
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
  };

  const handleOpenLink = () => {
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center bg-amber-100 rounded-xl">
              <i className="ri-store-2-line text-amber-600 text-base" />
            </div>
            <div>
              <h2 className="text-sm font-black text-zinc-900">Convidar nova loja</h2>
              <p className="text-xs text-zinc-400">Compartilhe o link de configuração</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-5">
          {/* Explanation */}
          <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-100">
            <p className="text-xs text-amber-800 leading-relaxed">
              <strong>Como funciona:</strong> Ao acessar este link, o proprietário do novo restaurante
              será guiado pelo assistente de configuração para criar a conta, configurar a loja,
              cardápio e equipe.
            </p>
          </div>

          {/* Link box */}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-2">Link de configuração</label>
            <div className="flex items-center gap-2 p-3 bg-zinc-50 rounded-xl border border-zinc-200">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-600 font-mono truncate">{url}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={handleOpenLink}
                  title="Abrir link"
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 cursor-pointer text-zinc-500 hover:text-zinc-700 transition-colors"
                >
                  <ExternalLink size={13} />
                </button>
                <button
                  onClick={handleCopy}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    copied
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-zinc-900 text-white hover:bg-zinc-700'
                  }`}
                >
                  {copied ? (
                    <>
                      <Check size={12} />
                      Copiado!
                    </>
                  ) : (
                    <>
                      <Link2 size={12} />
                      Copiar
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Share buttons */}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-2">Compartilhar via</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleWhatsApp}
                className="flex items-center justify-center gap-2 py-3 px-4 bg-[#25D366] hover:bg-[#1ebe5d] text-white rounded-xl text-sm font-bold transition-colors cursor-pointer whitespace-nowrap"
              >
                <MessageCircle size={16} />
                WhatsApp
              </button>
              <button
                onClick={handleEmail}
                className="flex items-center justify-center gap-2 py-3 px-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-bold transition-colors cursor-pointer whitespace-nowrap"
              >
                <Mail size={16} />
                E-mail
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5">
          <p className="text-[10px] text-zinc-400 text-center leading-relaxed">
            O link não expira. Qualquer pessoa com o link pode criar uma nova loja no sistema.
            Compartilhe apenas com quem você autorizar.
          </p>
        </div>
      </div>
    </div>
  );
}
