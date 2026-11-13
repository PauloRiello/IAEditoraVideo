// Erros da aplicação. Cada um tem um código estável, para a interface traduzir em mensagem.

export class ErroAplicacao extends Error {
  codigo: string;
  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "ErroAplicacao";
    this.codigo = codigo;
  }
}

/** Nenhum provedor de IA disponível oferece a capacidade pedida. */
export class CapacidadeIndisponivel extends ErroAplicacao {
  constructor(capacidade: string) {
    super("capacidade-indisponivel", `Nenhum provedor de IA disponível para "${capacidade}".`);
  }
}

export class NaoEncontrado extends ErroAplicacao {
  constructor(tipo: string, id: string) {
    super("nao-encontrado", `${tipo} "${id}" não existe.`);
  }
}
