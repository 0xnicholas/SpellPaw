// Composer state (Zustand) — local editor state only.
// Server persistence lives in TanStack Query (see Composer.tsx).
import { create } from "zustand";

export interface ComposerChannel {
  slug: string;
  name: string;
  connected: boolean;
}

interface ComposerState {
  globalDraft: string;
  /** Per-channel overrides — a channel is "touched" once the user edits it. */
  variants: Record<string, string>;
  touched: Record<string, boolean>;
  activeTab: string | null;
  setGlobalDraft: (text: string) => void;
  setVariant: (slug: string, content: string) => void;
  setActiveTab: (slug: string | null) => void;
  /** Effective content for a channel: override if touched, else the global draft. */
  contentFor: (slug: string) => string;
  reset: () => void;
}

export const useComposerStore = create<ComposerState>((set, get) => ({
  globalDraft: "",
  variants: {},
  touched: {},
  activeTab: null,
  setGlobalDraft: (text) => set({ globalDraft: text }),
  setVariant: (slug, content) =>
    set((s) => ({ variants: { ...s.variants, [slug]: content }, touched: { ...s.touched, [slug]: true } })),
  setActiveTab: (slug) => set({ activeTab: slug }),
  contentFor: (slug) =>
    get().touched[slug] ? get().variants[slug] ?? "" : get().globalDraft,
  reset: () => set({ globalDraft: "", variants: {}, touched: {}, activeTab: null }),
}));
