import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import { ThemeProvider } from './context/ThemeContext';
import { preloadPriorityGradients } from './lib/priorityColors';

registerSW({ immediate: true });

async function bootstrap() {
  // Warm-up de gradients para reduzir flash de cor estática nos cards.
  // Para evitar aplicação "em ondas" nos cards, aguardamos o preload completo
  // das variações antes do primeiro render.
  await preloadPriorityGradients({
    priorities: ['baixa', 'media', 'alta', 'absoluta'],
    variantsByPriority: {
      baixa: 8,
      media: 8,
      alta: 8,
      absoluta: 8,
    },
  });

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
