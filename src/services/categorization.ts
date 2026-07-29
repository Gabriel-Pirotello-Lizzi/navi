const rules: Array<[RegExp, string]> = [
  [/(uber|99\*|buser|posto|passagem)/i, "Transporte"],
  [/(mercado|hortifruti|ifood|rest|mcdonald|lancho|cafe|bonjour)/i, "Alimentação"],
  [/(amazon|shopee|zara|monte carlo|presente)/i, "Compras"],
  [/(saúde|mounjaro|farm|salon|barb)/i, "Saúde/Cuidados"],
  [/(airbnb|booking|viagem|ingresso)/i, "Lazer"],
  [/(instituto|formatura|estudo)/i, "Estudos"],
  [/(apple|stream|netflix|spotify)/i, "Casa/Contas"],
];

export function suggestCategory(description: string) {
  return rules.find(([pattern]) => pattern.test(description))?.[1] ?? "Outros";
}
