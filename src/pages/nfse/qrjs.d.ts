// Tipos mínimos do qr.js (usado direto no DANFSe; o pacote não traz tipagem).
declare module 'qr.js/lib/QRCode' {
  export default class QRCode {
    constructor(typeNumber: number, errorCorrectLevel: number);
    addData(data: string): void;
    make(): void;
    modules: boolean[][];
  }
}
declare module 'qr.js/lib/ErrorCorrectLevel' {
  const ErrorCorrectLevel: { L: number; M: number; Q: number; H: number };
  export default ErrorCorrectLevel;
}
