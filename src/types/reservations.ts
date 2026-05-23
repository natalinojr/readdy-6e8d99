export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'seated'
  | 'no_show'
  | 'cancelled';

export type ReservationOccasion =
  | 'birthday'
  | 'anniversary'
  | 'business'
  | 'other';

export interface TableReservation {
  id: string;
  tenant_id: string;

  /** Mesa pré-alocada (null = a definir na chegada) */
  table_id: string | null;

  // Dados do cliente
  customer_name: string;
  customer_phone: string;
  /** Vínculo com cadastro de cliente (opcional) */
  customer_id: string | null;
  party_size: number;

  // Data/hora
  reservation_date: string;   // ISO date "YYYY-MM-DD"
  reservation_time: string;   // "HH:MM:SS"
  duration_minutes: number;

  // Status
  status: ReservationStatus;

  /** Sessão de mesa criada quando o cliente senta */
  table_session_id: string | null;

  // Extras
  notes: string | null;
  occasion: ReservationOccasion | string | null;

  // Controle
  confirmed_by: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;

  created_at: string;
  updated_at: string;
}

/** Shape retornado pela view table_availability */
export interface TableAvailability {
  table_id: string;
  tenant_id: string;
  table_number: number;
  capacity: number;
  area: string | null;
  current_status: string;
  upcoming_reservations: Array<{
    reservation_id: string;
    date: string;
    time: string;
    party_size: number;
    customer: string;
  }> | null;
}

// ── Payloads para a Edge Function reservation-write ──────────────────────────

export interface CreateReservationPayload {
  action: 'create_reservation';
  tenant_id?: string;
  active_tenant_id?: string;
  table_id?: string | null;
  customer_name: string;
  customer_phone: string;
  customer_id?: string | null;
  party_size: number;
  reservation_date: string;
  reservation_time: string;
  duration_minutes?: number;
  notes?: string | null;
  occasion?: ReservationOccasion | string | null;
  status?: 'pending' | 'confirmed';
}

export interface ConfirmReservationPayload {
  action: 'confirm_reservation';
  reservation_id: string;
  active_tenant_id?: string;
}

export interface SeatReservationPayload {
  action: 'seat_reservation';
  reservation_id: string;
  table_id?: string | null;
  session_id?: string | null;
  active_tenant_id?: string;
}

export interface CancelReservationPayload {
  action: 'cancel_reservation';
  reservation_id: string;
  cancellation_reason?: string;
  active_tenant_id?: string;
}

export interface ListReservationsPayload {
  action: 'list_reservations';
  reservation_date?: string;
  status?: ReservationStatus | ReservationStatus[];
  active_tenant_id?: string;
}
