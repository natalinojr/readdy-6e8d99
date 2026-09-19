// Camada de texto de um PDF (base64), sem modelo — para copiar números exatos (linha digitável,
// Pix copia e cola) em vez de depender da leitura por IA. PDF que é só imagem/desenho (o DAS do
// SENDA, por exemplo) volta vazio: aí fica a leitura por IA + conferência dos dígitos.
import { extractText, getDocumentProxy } from 'npm:unpdf@1.8.1';

export async function textoDoPdf(base64: string, limite = 20000): Promise<string> {
  try {
    const bin = Uint8Array.from(atob(String(base64 ?? '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '')), (c) => c.charCodeAt(0));
    const pdf = await getDocumentProxy(bin);
    const { text } = await extractText(pdf, { mergePages: true });
    return String(text ?? '').slice(0, limite);
  } catch {
    return '';
  }
}
