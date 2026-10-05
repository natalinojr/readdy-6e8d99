import AvisoPublico from '@/components/base/AvisoPublico';

// Rota /invite aposentada (2026-10-05): o convite atual é o código de loja (Admin Master) usado em
// /onboarding?invite=<código>. A página antiga (./page.tsx), de token com senha provisória, continua no
// repositório, mas não é mais aberta por nenhuma rota.
export default function ConviteAntigo() {
  return (
    <AvisoPublico icone="ri-mail-close-line" titulo="Esse convite não vale mais">
      Peça um novo a quem te convidou.
    </AvisoPublico>
  );
}
