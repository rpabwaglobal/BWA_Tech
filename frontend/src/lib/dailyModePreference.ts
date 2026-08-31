/**
 * Preferência do usuário: abrir Prioridades já no Daily Mode.
 *
 * É o `dailyOnLoad` do protótipo. Quem conduz a reunião abre esta página várias
 * vezes por dia e sempre no mesmo modo; ter de clicar no seletor toda vez é o
 * tipo de atrito pequeno que se paga em irritação diária.
 *
 * CHAVE PRÓPRIA, e não um campo dentro de um objeto de preferências
 * compartilhado — mesma escolha de `kanbanCardDisplayPreference` e
 * `suporteCardDisplayPreference`. Chaves separadas não se derrubam quando uma
 * delas muda de forma, e o `catch` de uma não engole o valor da outra.
 */
export const DAILY_MODE_ON_LOAD_KEY = 'bwa_prioridades_daily_on_load_v1';

export function readDailyModeOnLoad(): boolean {
  try {
    return window.localStorage.getItem(DAILY_MODE_ON_LOAD_KEY) === 'true';
  } catch {
    // localStorage indisponível (SSR, modo privado do Safari, política de
    // grupo). O padrão é o modo normal: abrir numa visualização que a pessoa
    // não escolheu é pior do que ignorar a preferência.
  }
  return false;
}

export function writeDailyModeOnLoad(value: boolean): void {
  try {
    window.localStorage.setItem(DAILY_MODE_ON_LOAD_KEY, value ? 'true' : 'false');
  } catch {
    // ignore
  }
}
