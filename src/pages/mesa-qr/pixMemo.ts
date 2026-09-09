// ── Memória local do Pix em andamento ────────────────────────────────────────
// O cliente sai do navegador para pagar no app do banco. Quando volta, três coisas
// podem ter acontecido: a aba foi descartada pelo Android, ele deu "puxar para
// atualizar", ou a sessão da mesa fechou sozinha (trigger de conta zerada) e o
// participante salvo virou inválido. Em qualquer um dos casos o dinheiro já saiu —
// então guardamos aqui o mínimo para reabrir o comprovante depois do reload.

export type PixMemo = {
  pixId: string;
  participantId: string;
  accessToken: string;
  amount: number;
  at: number;
};

const TTL_MS = 60 * 60 * 1000; // 1h — depois disso o comprovante já não interessa

function key(qrToken: string) {
  return 'mesa_pix_' + qrToken;
}

export function savePixMemo(qrToken: string, memo: Omit<PixMemo, 'at'>) {
  try {
    localStorage.setItem(key(qrToken), JSON.stringify({ ...memo, at: Date.now() }));
  } catch { /* modo privado / cota cheia: seguimos sem memória */ }
}

export function loadPixMemo(qrToken: string): PixMemo | null {
  try {
    const raw = localStorage.getItem(key(qrToken));
    if (!raw) return null;
    const memo = JSON.parse(raw) as PixMemo;
    if (!memo?.pixId || !memo?.participantId || !memo?.accessToken) return null;
    if (Date.now() - (memo.at ?? 0) > TTL_MS) {
      clearPixMemo(qrToken);
      return null;
    }
    return memo;
  } catch {
    return null;
  }
}

export function clearPixMemo(qrToken: string) {
  try { localStorage.removeItem(key(qrToken)); } catch { /* ignore */ }
}
