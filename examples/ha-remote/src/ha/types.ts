// The types that the ha/ modules share. No React, no GTK.
import type { ListRow } from '@maemo-react/widgets';

export const DOMAINS = ['light', 'switch', 'fan', 'input_boolean', 'climate', 'cover'] as const;
export type Domain = (typeof DOMAINS)[number];

export interface Area {
  id: string;
  name: string;
}

/** One entity that the application shows. The object changes only when the entity changes. */
export interface Entity {
  id: string;
  domain: Domain;
  name: string;
  areaId: string | null;
  state: string;
  attrs: Record<string, unknown>;
}

/** A row of the entity List. The object changes only when its text or its toggle changes. */
export interface Row extends ListRow {
  key: string;
  name: string;
  state: string;
  on: boolean | null;
}

export interface Page {
  key: string;
  name: string;
  rows: Row[];
}

/** A row of the page List. */
export interface PageRow extends ListRow {
  key: string;
  name: string;
}

export interface ServiceCall {
  domain: string;
  service: string;
  service_data?: Record<string, unknown>;
  target: { entity_id: string };
}

/** The compressed state of subscribe_entities. */
export interface CompressedState {
  s: string;
  a: Record<string, unknown>;
  lc?: number;
  lu?: number;
  c?: unknown;
}

/** One subscribe_entities event: added, changed and removed entities. */
export interface StatesEvent {
  a?: Record<string, CompressedState>;
  c?: Record<string, { '+'?: Partial<CompressedState>; '-'?: { a?: string[] } }>;
  r?: string[];
}
