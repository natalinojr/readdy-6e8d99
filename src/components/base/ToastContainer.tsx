import { useEffect, useState } from 'react';
import { useToast, type Toast } from '../../contexts/ToastContext';

const CONFIG = {
  success: {
    icon: 'ri-checkbox-circle-fill',
    bar: 'bg-green-500',
    bg: 'bg-white border-green-200',
    iconColor: 'text-green-500',
    title: 'text-gray-800',
  },
  error: {
    icon: 'ri-close-circle-fill',
    bar: 'bg-red-500',
    bg: 'bg-white border-red-200',
    iconColor: 'text-red-500',
    title: 'text-gray-800',
  },
  warning: {
    icon: 'ri-error-warning-fill',
    bar: 'bg-yellow-400',
    bg: 'bg-white border-yellow-200',
    iconColor: 'text-yellow-500',
    title: 'text-gray-800',
  },
  info: {
    icon: 'ri-information-fill',
    bar: 'bg-sky-500',
    bg: 'bg-white border-sky-200',
    iconColor: 'text-sky-500',
    title: 'text-gray-800',
  },
};

function ToastItem({ toast }: { toast: Toast }) {
  const { removeToast } = useToast();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  const cfg = CONFIG[toast.type];

  return (
    <div
      className={`relative flex items-start gap-3 w-80 rounded-xl border shadow-lg px-4 py-3 transition-all duration-300 ${cfg.bg} ${
        visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'
      }`}
    >
      {/* Barra lateral colorida */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${cfg.bar}`} />

      {/* Ícone */}
      <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.iconColor}`}>
        <i className={`${cfg.icon} text-lg`} />
      </div>

      {/* Texto */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold leading-tight ${cfg.title}`}>{toast.title}</p>
        {toast.message && (
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{toast.message}</p>
        )}
      </div>

      {/* Fechar */}
      <button
        onClick={() => removeToast(toast.id)}
        className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-gray-500 cursor-pointer flex-shrink-0 transition-colors"
      >
        <i className="ri-close-line text-base" />
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const { toasts } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} />
        </div>
      ))}
    </div>
  );
}
