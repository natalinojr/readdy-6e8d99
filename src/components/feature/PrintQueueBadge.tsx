import { useEffect, useState } from 'react';
import { usePrintQueue } from '@/hooks/usePrintQueue';
import { useAuth } from '@/contexts/AuthContext';

interface PrintQueueBadgeProps {
  onClick?: () => void;
}

export default function PrintQueueBadge({ onClick }: PrintQueueBadgeProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { pendingCount, failedCount, isProcessing, processQueue } = usePrintQueue(tenantId);
  const [pulse, setPulse] = useState(false);

  const total = pendingCount + failedCount;

  useEffect(() => {
    if (total > 0) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 2000);
      return () => clearTimeout(t);
    }
  }, [total]);

  if (total === 0) return null;

  return (
    <button
      onClick={onClick ?? processQueue}
      disabled={isProcessing}
      className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
        failedCount > 0
          ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
          : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
      } ${pulse ? 'animate-pulse' : ''}`}
    >
      <div className="w-4 h-4 flex items-center justify-center">
        {isProcessing ? (
          <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <i className="ri-printer-line" />
        )}
      </div>
      <span>
        {isProcessing ? 'Imprimindo...' : `${total} fila${total > 1 ? 's' : ''}`}
      </span>
      {failedCount > 0 && (
        <span className="w-4 h-4 flex items-center justify-center bg-red-500 text-white text-[9px] font-black rounded-full">
          {failedCount}
        </span>
      )}
    </button>
  );
}
