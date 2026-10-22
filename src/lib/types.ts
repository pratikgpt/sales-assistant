// Shapes returned by the dashboard API (dates arrive as ISO strings).
import type { Assignment, LeadFields, Qualification } from "./qualify";
import type { Slot } from "./slots";
import type { Stage } from "./store";

export type ChannelName = "whatsapp" | "instagram" | "email";

export interface LeadSummary {
  id: string;
  status: Qualification["status"];
  stage: Stage;
  takeover: boolean;
  attention: string | null;
  assignment: Assignment | null;
  last_message_at: string;
  channel: ChannelName;
  display_name: string | null;
  handle: string | null;
  external_id: string;
  last_text: string | null;
  last_direction: "in" | "out" | null;
  booking_status: "pending" | "confirmed" | "uncertain" | null;
  has_failed_send: boolean;
}

export interface MessageView {
  id: string;
  direction: "in" | "out";
  author: "customer" | "assistant" | "human";
  text: string;
  status: string;
  error: string | null;
  created_at: string;
}

export interface EventView {
  id: string;
  level: "info" | "warn" | "error";
  kind: string;
  text: string;
  data: unknown;
  created_at: string;
}

export interface BookingView {
  id: string;
  rep_id: string;
  slot_start: string;
  slot_end: string;
  status: "pending" | "confirmed" | "uncertain" | "failed";
  html_link: string | null;
  error: string | null;
}

export interface LeadDetail {
  lead: {
    id: string;
    status: Qualification["status"];
    stage: Stage;
    fields: LeadFields;
    qualification: Qualification | null;
    assignment: Assignment | null;
    offered_slots: Slot[];
    pending_slot: Slot | null;
    policy_version: number | null;
    takeover: boolean;
    attention: string | null;
    created_at: string;
  };
  contact: { channel: ChannelName; external_id: string; display_name: string | null; handle: string | null };
  messages: MessageView[];
  events: EventView[];
  bookings: BookingView[];
  timezone: string;
  policy_version: number;
  services: { id: string; name: string }[];
}

export interface IntegrationView {
  name: "whatsapp" | "instagram" | "email" | "calendar" | "llm";
  configured: boolean;
  status: "ok" | "error" | "auth_error" | "unknown" | "not_configured";
  detail: string | null;
  last_ok_at: string | null;
  last_error_at: string | null;
}
