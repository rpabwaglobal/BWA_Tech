import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ThemeProvider } from './context/ThemeContext';
import { preloadPriorityGradients } from './lib/priorityColors';

async function bootstrap() {
  // Warm-up de gradients para reduzir flash de cor estática nos cards.
  // Estratégia: pré-carregar 01 de todas as prioridades e todas as variações
  // das prioridades mais usadas visualmente.
  await Promise.race([
    preloadPriorityGradients({
      priorities: ['baixa', 'media', 'alta', 'absoluta'],
      variantsByPriority: {
        baixa: 8,
        media: 8,
        alta: 8,
        absoluta: 8,
      },
    }),
    new Promise((resolve) => setTimeout(resolve, 350)),
  ]);

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
