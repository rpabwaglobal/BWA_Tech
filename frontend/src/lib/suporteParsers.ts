/**
 * Parsers para campos que chegam serializados de fontes externas (formulário
 * de abertura de chamado) e precisam ser exibidos como dados estruturados.
 */

export type DescricaoParsed = {
  /** Nome do item/robô extraído do prefixo "[Item selecionado: <nome>]".
   *  null se a descrição não tem o marcador. */
  robotName: string | null;
  /** Resto da descrição depois do prefixo (sem [Item selecionado: ...] e
   *  sem as quebras de linha que vinham logo após). */
  cleanText: string;
};

/**
 * Extrai o nome do item/robô do início da descrição.
 *
 * Formato esperado:
 *   "[Item selecionado: Provisões Finanças Contábil]\n\nDescrição aqui..."
 *
 * Aceita variações de espaços e quebras de linha após o marcador. Se a
 * descrição não tiver o prefixo, devolve { robotName: null, cleanText: raw }.
 */
export function parseDescricao(descricao: string | null | undefined): DescricaoParsed {
  const raw = descricao ?? '';
  // Match não-ganancioso (.*?) e \r\n? cobre Windows/Unix.
  const m = raw.match(/^\s*\[Item selecionado:\s*(.*?)\]\s*(?:\r?\n)*/);
  if (!m) {
    return { robotName: null, cleanText: raw.trim() };
  }
  const robotName = m[1].trim();
  const cleanText = raw.slice(m[0].length).trim();
  return {
    robotName: robotName || null,
    cleanText,
  };
}

export type EmpresaParsed = {
  nome: string;
  cnpj: string;
  uuid: string;
};

/**
 * Parsea o campo empresa, que vem no formato:
 *   "SOBRALANA PERFUMES LTDA||41.101.742/0001-90||e1cdab21-...-...||2"
 *
 * Separador: `||` (literal). Campos:
 *   0 = nome da empresa
 *   1 = CNPJ (com pontuação)
 *   2 = UUID
 *   3 = ignorado (número interno)
 *
 * Retorna null se a string for vazia ou não contiver as 3 partes mínimas.
 */
export function parseEmpresa(empresa: string | null | undefined): EmpresaParsed | null {
  if (!empresa) return null;
  const parts = empresa.split('||').map((s) => s.trim());
  if (parts.length < 3) return null;
  const [nome, cnpj, uuid] = parts;
  // Trate "vazio em todos" como ausente — evita exibir labels vazios.
  if (!nome && !cnpj && !uuid) return null;
  return { nome: nome ?? '', cnpj: cnpj ?? '', uuid: uuid ?? '' };
}
