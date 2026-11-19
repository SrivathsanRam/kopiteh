import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "../../types/auth";

interface AuthState {
  accessToken: string | null;
  user: User | null;
  isHydrated: boolean;
  setAccessToken: (token: string | null) => void;
  setUser: (user: User | null) => void;
  setHydrated: (value: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      isHydrated: false,
      setAccessToken: (accessToken) => set({ accessToken }),
      setUser: (user) => set({ user }),
      setHydrated: (isHydrated) => set({ isHydrated }),
      logout: () => set({ accessToken: null, user: null }),
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({ user: state.user }),
      onRehydrateStorage: () => (state) => state?.setHydrated(true),
    },
  ),
);
