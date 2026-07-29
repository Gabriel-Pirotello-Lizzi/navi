import type { Workspace } from "@/src/domain/types";

export const BACKUP_VERSION = 1;

export function createBackup(workspace: Workspace) {
  return JSON.stringify({
    app: "navi",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: workspace,
  }, null, 2);
}

export function downloadBackup(workspace: Workspace) {
  const blob = new Blob([createBackup(workspace)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `navi-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function transactionsToCSV(workspace: Workspace) {
  const header = ["data", "tipo", "descricao", "categoria", "valor_centavos", "status"];
  const lines = workspace.transactions.map((item) => [
    item.occurred_on,
    item.kind,
    `"${item.description.replaceAll('"', '""')}"`,
    `"${item.category.replaceAll('"', '""')}"`,
    item.amount_cents,
    item.status,
  ].join(";"));
  return [header.join(";"), ...lines].join("\n");
}
