import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * Impressão digital do código do TOTEM (autoatendimento) → `out/kiosk-version.json`.
 *
 * O totem se atualiza sozinho quando sai versão nova. Comparando o script de entrada,
 * QUALQUER publicação contava como versão nova — em 2026-09-29 foram ~70 pushes
 * (Trilha, Tarefas, Contratação…) e o Tablet 2 da Paranaguá recarregou 22 vezes com a
 * loja aberta, sem nenhuma mudança no tablet. Pedido do dono: o tablet só atualiza
 * quando muda algo do tablet.
 *
 * Entra na conta o código-fonte de tudo que a tela do autoatendimento importa (só
 * imports estáticos, sem seguir as outras telas carregadas sob demanda) + a base comum
 * do app (main.tsx e o que ele importa estaticamente: providers/contexts, supabase…,
 * parando na tabela de rotas) + o package-lock (versão de biblioteca).
 */
const KIOSK_PAGE = resolve(__dirname, "src/pages/autoatendimento/page.tsx");
const ENTRY = resolve(__dirname, "src/main.tsx");
const PARA_EM = ["/src/router/config.tsx"];

export function kioskVersionPlugin(): Plugin {
  return {
    name: "erpos-kiosk-version",
    apply: "build",
    generateBundle() {
      const norm = (id: string) => id.split("?")[0].replace(/\\/g, "/");
      const alvo = new Set([norm(KIOSK_PAGE), norm(ENTRY)]);
      const vistos = new Set<string>();
      const fila: string[] = [];
      for (const id of this.getModuleIds()) if (alvo.has(norm(id))) fila.push(id);
      if (fila.length < 2) {
        this.warn(`[kiosk-version] tela do totem ou main.tsx fora do build — sem kiosk-version.json`);
        return;
      }
      while (fila.length) {
        const id = fila.pop()!;
        if (vistos.has(id)) continue;
        // A tabela de rotas puxa o AppLayout (chat, Pendências, menu) e as telas que não são
        // lazy — nada disso roda no totem, que fica fora do layout.
        if (PARA_EM.some((p) => norm(id).endsWith(p))) continue;
        vistos.add(id);
        for (const dep of this.getModuleInfo(id)?.importedIds ?? []) if (!vistos.has(dep)) fila.push(dep);
      }
      const hash = createHash("sha256");
      const raiz = norm(__dirname) + "/";
      for (const id of [...vistos].map(norm).sort()) {
        if (id.includes("/node_modules/") || id.startsWith("\0")) continue;
        hash.update(id.startsWith(raiz) ? id.slice(raiz.length) : id);
        try { hash.update(readFileSync(id)); } catch { /* módulo virtual */ }
      }
      try { hash.update(readFileSync(resolve(__dirname, "package-lock.json"))); } catch { /* sem lock */ }
      if (process.env.KIOSK_VERSION_DEBUG) this.emitFile({ type: "asset", fileName: "kiosk-version-arquivos.txt", source: [...vistos].map(norm).filter((i) => !i.includes("/node_modules/")).sort().join("\n") });
      this.emitFile({
        type: "asset",
        fileName: "kiosk-version.json",
        source: JSON.stringify({ v: hash.digest("hex").slice(0, 16), modulos: vistos.size }),
      });
    },
  };
}
