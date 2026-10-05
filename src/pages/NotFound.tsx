import TelaAviso from '@/components/base/TelaAviso';

export default function NotFound() {
  return (
    <TelaAviso cheia icone="ri-compass-3-line" titulo="Não achei essa página">
      O endereço pode ter mudado ou estar errado. Volte para o começo e siga pelo menu.
    </TelaAviso>
  );
}
