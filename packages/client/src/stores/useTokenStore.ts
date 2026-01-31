import { create } from 'zustand';
import type { Token } from '@hex-crawl/shared';

interface TokenState {
  /** All tokens keyed by token.id */
  tokens: Map<string, Token>;
}

interface TokenActions {
  /** Replace all tokens (e.g. from token:state message) */
  setTokens: (tokens: Token[]) => void;
  /** Move a token to a new hex */
  moveToken: (tokenId: string, newHexKey: string) => void;
  /** Add a single token */
  addToken: (token: Token) => void;
  /** Remove a token by id */
  removeToken: (tokenId: string) => void;
  /** Partially update a token */
  updateToken: (tokenId: string, updates: Partial<Token>) => void;
  /** Clear all tokens */
  clearTokens: () => void;
}

export type TokenStore = TokenState & TokenActions;

export const useTokenStore = create<TokenStore>((set) => ({
  tokens: new Map(),

  setTokens: (tokenArray) => {
    const tokens = new Map<string, Token>();
    for (const t of tokenArray) {
      tokens.set(t.id, t);
    }
    set({ tokens });
  },

  moveToken: (tokenId, newHexKey) =>
    set((state) => {
      const tokens = new Map(state.tokens); // New reference for reactivity
      const token = tokens.get(tokenId);
      if (token) {
        tokens.set(tokenId, { ...token, hexKey: newHexKey });
      }
      return { tokens };
    }),

  addToken: (token) =>
    set((state) => {
      const tokens = new Map(state.tokens);
      tokens.set(token.id, token);
      return { tokens };
    }),

  removeToken: (tokenId) =>
    set((state) => {
      const tokens = new Map(state.tokens);
      tokens.delete(tokenId);
      return { tokens };
    }),

  updateToken: (tokenId, updates) =>
    set((state) => {
      const tokens = new Map(state.tokens);
      const token = tokens.get(tokenId);
      if (token) {
        tokens.set(tokenId, { ...token, ...updates });
      }
      return { tokens };
    }),

  clearTokens: () => set({ tokens: new Map() }),
}));
