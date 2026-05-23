import { useState } from 'react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  icon?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  icon = 'ri-alert-line',
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  const confirmBtnClass = danger
    ? 'bg-red-500 text-white hover:bg-red-600'
    : 'bg-amber-500 text-white hover:bg-amber-600';

  const iconClass = danger ? 'text-red-500' : 'text-amber-500';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="p-6 text-center">
          <div className="w-14 h-14 mx-auto mb-4 flex items-center justify-center rounded-full bg-zinc-50">
            <i className={`${icon} text-2xl ${iconClass}`} />
          </div>
          <h3 className="text-base font-bold text-zinc-800 mb-2">
            {title}
          </h3>
          <p className="text-sm text-zinc-500 leading-relaxed">
            {message}
          </p>
        </div>
        <div className="flex items-center gap-2 px-5 py-4 bg-zinc-50 border-t border-zinc-100">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-white hover:shadow-sm rounded-xl transition-all cursor-pointer disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className={`flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl transition-all cursor-pointer disabled:opacity-50 ${confirmBtnClass}`}
          >
            {loading ? (
              <i className="ri-loader-4-line animate-spin" />
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}