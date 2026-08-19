import api from './api';

/**
 * A versão vem do BACKEND, e não de uma constante do frontend.
 *
 * O motivo é o que a versão precisa responder: "o que está no ar agora?". Uma
 * constante compilada no bundle responde "o que estava no ar quando este
 * arquivo foi buildado" — e um navegador com o bundle antigo em cache mostraria
 * a versão velha com toda a confiança do mundo, que é o erro mais perigoso que
 * um indicador de versão pode cometer.
 *
 * O backend lê o arquivo `VERSION` da raiz do repositório. Um lugar só.
 */
export type VersaoDoSistema = {
  version: string;
};

export const versaoService = {
  /** Devolve a versão, ou string vazia se a API não responder.
   *
   * SEM CACHE, pelo mesmo motivo que o backend não cacheia: um SPA fica aberto
   * por horas e atravessa deploys. Guardar o valor faria a tela mostrar com
   * confiança a versão de antes do deploy — o erro exato que este indicador
   * existe para não cometer. É uma requisição minúscula, numa página que quase
   * ninguém abre duas vezes seguidas.
   *
   * Vazio em vez de "erro" de propósito: a versão é informação de rodapé, e uma
   * falha em buscá-la não merece ocupar a tela de ninguém — quem abriu o perfil
   * foi tratar da própria conta. A tela simplesmente não desenha a linha.
   */
  async obter(): Promise<string> {
    try {
      const { data } = await api.get<VersaoDoSistema>('/');
      return (data?.version ?? '').trim();
    } catch {
      return '';
    }
  },
};
