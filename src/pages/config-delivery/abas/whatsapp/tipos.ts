// Tipos do grupo WhatsApp do Delivery (abas Conversas e Assistente).
// Tabelas wa_loja_bots / wa_loja_conversas / wa_loja_mensagens (RLS: só o dono da loja lê e escreve).

export interface Bot {
  tenant_id: string;
  is_active: boolean;
  code: string;
  phone_id: string | null;
  waba_id: string | null;
  numero_origem: 'erpos' | 'cliente' | null;
  start_text: string | null;
  welcome: string | null;
  extra_info: string | null;
  forbidden: string | null;
  voucher_code: string | null;
  upsell: boolean;
  notify_owner: boolean;
}

export interface Conversa {
  id: string;
  contact_phone: string;
  contact_name: string | null;
  via: string;
  status: string;
  is_test: boolean;
  needs_human: boolean;
  bot_paused_until: string | null;
  link_sent_at: string | null;
  cost_usd: number;
  last_message_at: string;
}

export interface Mensagem {
  id: number;
  role: 'user' | 'assistant' | 'staff';
  content: string;
  created_at: string;
}
