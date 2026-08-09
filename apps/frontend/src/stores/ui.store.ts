import { create } from 'zustand';

/**
 * UI store — manages client-only visual state.
 * DO NOT store server data here; use TanStack Query for that.
 */
interface UIState {
  /** Whether the sidebar/nav drawer is open */
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  /** Current theme preference */
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

export const useUIStore = create<UIState>((set) => ({
  isSidebarOpen: true,
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarOpen: (open) => set({ isSidebarOpen: open }),

  theme: 'system',
  setTheme: (theme) => set({ theme }),
}));
