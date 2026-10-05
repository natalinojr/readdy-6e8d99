import TelaAviso from '@/components/base/TelaAviso';

// Cai aqui qualquer endereço dentro do sistema que não existe (rota '*' do layout).
export default function PaginaEmConstrucao() {
  return (
    <TelaAviso icone="ri-compass-3-line" titulo="Não achei essa página">
      O endereço pode ter mudado ou estar errado. Volte para o começo e siga pelo menu.
    </TelaAviso>
  );
}
