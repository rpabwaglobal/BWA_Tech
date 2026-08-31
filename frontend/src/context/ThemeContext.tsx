import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { aplicarTemaComCirculo, type OrigemDaTroca } from '@/lib/temaCircular';

type Theme = 'light' | 'dark';

type ThemeContextValue = {
  theme: Theme;
  /** A origem é o centro do botão clicado: é de lá que o círculo abre. Sem ela
   *  a troca é seca — o caminho de quem muda o tema pelo sistema. */
  toggleTheme: (origem?: OrigemDaTroca) => void;
  setTheme: (theme: Theme, origem?: OrigemDaTroca) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const THEME_STORAGE_KEY = 'bwa-theme';

function getSystemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // ignore
  }
  return getSystemTheme();
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  /**
   * De onde o círculo deve abrir na PRÓXIMA troca.
   *
   * NUMA REF, e não em estado: ela é lida pelo efeito que já roda por causa do
   * `theme`, e não precisa disparar render nenhum. Em estado, cada clique
   * causaria dois renders — um pela origem, outro pelo tema.
   */
  const origemDaTroca = useRef<OrigemDaTroca | null>(null);

  useEffect(() => {
    // A ORIGEM É CONSUMIDA, e não fica pendurada: sem zerar, uma troca de tema
    // vinda do sistema reaproveitaria o ponto do último clique e o círculo
    // abriria de um botão que ninguém tocou.
    const origem = origemDaTroca.current;
    origemDaTroca.current = null;

    aplicarTemaComCirculo(theme === 'dark', origem);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event: MediaQueryListEvent) => {
      // Só seguir sistema se o usuário não tiver escolhido nada explicitamente
      try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
        if (stored === 'light' || stored === 'dark') return;
      } catch {
        // ignore
      }
      setThemeState(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  const setTheme = (next: Theme, origem?: OrigemDaTroca) => {
    origemDaTroca.current = origem ?? null;
    setThemeState(next);
  };

  const toggleTheme = (origem?: OrigemDaTroca) => {
    origemDaTroca.current = origem ?? null;
    setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

