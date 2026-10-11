"use client";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Download, FileText, Plus, Search, SlidersHorizontal, Upload, X } from "lucide-react";
import type { DocumentKind, DocumentStatus, DocumentView, Page, SignatureRole, SignatureView, TemplateView, VersionView } from "@peopleflow/contracts";
import { api, apiUpload, errorMessage } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/utils";
import { useUser } from "./authenticated-shell";
import { PageHeading } from "./page-heading";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { EmptyState, ErrorState, LoadingState } from "./ui/feedback";
import { Input } from "./ui/input";

const kindLabels: Record<DocumentKind, string> = { CONTRACT: "Contrato", TERM_SHEET: "Termo", POLICY: "Política", PAYSLIP: "Holerite", DECLARATION: "Declaração", OTHER: "Outro" };
const statusLabels: Record<DocumentStatus, string> = { DRAFT: "Rascunho", PUBLISHED: "Publicado", ARCHIVED: "Arquivado" };
const signatureRoleLabels: Record<SignatureRole, string> = { EMPLOYEE: "Colaborador", EMPLOYER: "Empregador", WITNESS: "Testemunha" };
const signatureStatusLabels: Record<string, string> = { PENDING: "Pendente", SIGNED: "Assinada", REJECTED: "Recusada" };

function StatusPill({ tone, label }: { tone: "neutral" | "success" | "warning" | "danger"; label: string }) {
  const classes = tone === "success" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : tone === "warning" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground";
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${classes}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{label}</span>;
}

type DownloadPayload = { url: string; fileName: string; versionNumber: number };

export function DocumentsView() {
  const user = useUser();
  const queryClient = useQueryClient();
  const canManage = user.role === "ADMIN" || user.role === "HR";
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<DocumentKind | "">("");
  const [status, setStatus] = useState<DocumentStatus | "">("");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [uploadFor, setUploadFor] = useState<DocumentView | undefined>();
  const [signFor, setSignFor] = useState<{ document: DocumentView; signature: SignatureView } | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { const timeout = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 350); return () => clearTimeout(timeout); }, [search]);

  const documents = useQuery({ queryKey: ["documents", user.companyId, page, pageSize, query, kind, status], queryFn: ({ signal }) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (query) params.set("q", query);
    if (kind) params.set("kind", kind);
    if (status) params.set("status", status);
    return api<Page<DocumentView>>(`/documents?${params}`, { signal });
  }, placeholderData: keepPreviousData });
  const data = documents.data;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  useEffect(() => { if (data && !documents.isPlaceholderData && page > pages) setPage(pages); }, [data, documents.isPlaceholderData, page, pages]);

  async function download(document: DocumentView) {
    setBusy(true); setError("");
    try {
      const payload = await api<DownloadPayload>(`/documents/${document.id}/download-url`);
      const anchor = window.document.createElement("a");
      anchor.href = payload.url; anchor.download = payload.fileName; anchor.rel = "noopener";
      window.document.body.appendChild(anchor); anchor.click(); anchor.remove();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  function refresh() { void queryClient.invalidateQueries({ queryKey: ["documents"] }); }

  return <>
    <PageHeading eyebrow="Documentos digitais" title="Documentos" description={canManage ? "Crie documentos, envie versões assináveis e registre assinaturas manuais com evidência." : "Consulte os documentos vinculados ao seu cadastro ou às suas assinaturas pendentes."} action={canManage ? <Button onClick={() => { setCreateOpen(true); setError(""); }}><Plus className="h-4 w-4" />Novo documento</Button> : undefined} />
    {notice && <div role="status" className="mb-5 flex items-center justify-between rounded-md border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">{notice}<Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Dispensar confirmação" onClick={() => setNotice("")}><X className="h-4 w-4" /></Button></div>}
    {error && <div role="alert" className="mb-5 rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" /><h2 className="text-sm font-semibold">Documentos da empresa</h2>{data && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{formatNumber(data.total)}</span>}</div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Buscar documentos por título" placeholder="Buscar título…" className="pl-9 sm:w-56" value={search} onChange={event => setSearch(event.target.value)} /></div>
          <div className="relative"><SlidersHorizontal className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><select aria-label="Filtrar por tipo" className="h-11 w-full rounded-md border bg-card pl-9 pr-8 text-sm sm:w-40" value={kind} onChange={event => { setKind(event.target.value as DocumentKind | ""); setPage(1); }}><option value="">Todos os tipos</option>{(Object.keys(kindLabels) as DocumentKind[]).map(value => <option key={value} value={value}>{kindLabels[value]}</option>)}</select></div>
          {canManage && <div className="relative"><SlidersHorizontal className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><select aria-label="Filtrar por status" className="h-11 w-full rounded-md border bg-card pl-9 pr-8 text-sm sm:w-40" value={status} onChange={event => { setStatus(event.target.value as DocumentStatus | ""); setPage(1); }}><option value="">Todos os status</option><option value="DRAFT">Rascunho</option><option value="PUBLISHED">Publicado</option><option value="ARCHIVED">Arquivado</option></select></div>}
        </div>
      </div>
      {documents.isPending ? <LoadingState /> : documents.isError ? <ErrorState message={errorMessage(documents.error)} onRetry={() => void documents.refetch()} /> : data && data.items.length === 0 ? <EmptyState title={query || kind || status ? "Nenhum documento encontrado" : "Nenhum documento ainda"} description={canManage ? "Crie o primeiro documento para começar a versionar e assinar." : "Documentos destinados a você aparecerão aqui."} /> : data ? <div className="relative overflow-x-auto" aria-busy={documents.isFetching}>{documents.isFetching && <div role="status" className="border-b bg-primary/5 px-5 py-2 text-xs text-primary">Atualizando lista…</div>}<table className="w-full text-left text-sm"><caption className="sr-only">Documentos com tipo, status, versão atual e ações</caption><thead className="border-b bg-background text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th scope="col" className="px-5 py-3 font-medium">Documento</th><th scope="col" className="px-5 py-3 font-medium">Tipo</th><th scope="col" className="px-5 py-3 font-medium">Status</th><th scope="col" className="whitespace-nowrap px-5 py-3 font-medium">Versão</th><th scope="col" className="px-5 py-3 font-medium">Assinaturas</th><th scope="col" className="px-5 py-3 text-right font-medium">Ações</th></tr></thead><tbody>{data.items.map(document => {
        const signatures = document.signatures ?? [];
        const pendingMine = signatures.filter(s => s.status === "PENDING" && (s.signerUserId === user.id || (!s.signerUserId && user.role === "EMPLOYEE" && document.employeeId !== null)));
        return <tr key={document.id} className="border-b transition-colors last:border-0 hover:bg-muted/40">
          <td className="px-5 py-4"><p className="font-medium">{document.title}</p><p className="mt-0.5 text-xs text-muted-foreground">Criado em {formatDate(document.createdAt)}</p></td>
          <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{kindLabels[document.kind]}</td>
          <td className="whitespace-nowrap px-5 py-4"><StatusPill tone={document.status === "PUBLISHED" ? "success" : document.status === "ARCHIVED" ? "neutral" : "warning"} label={statusLabels[document.status]} /></td>
          <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{document.currentVersion ? `v${document.currentVersion.versionNumber} · ${document.currentVersion.file?.fileName ?? "sem arquivo"}` : "sem versão"}</td>
          <td className="px-5 py-4"><div className="flex flex-wrap gap-1.5">{signatures.length === 0 ? <span className="text-xs text-muted-foreground">nenhuma</span> : signatures.map(signature => <StatusPill key={signature.id} tone={signature.status === "SIGNED" ? "success" : signature.status === "REJECTED" ? "danger" : "warning"} label={`${signature.signerName} (${signatureRoleLabels[signature.role]}): ${signatureStatusLabels[signature.status]}`} />)}</div></td>
          <td className="px-5 py-4">
            <div className="flex items-center justify-end gap-1">
              {pendingMine.map(signature => <Button key={signature.id} size="sm" variant="outline" disabled={busy} onClick={() => { setSignFor({ document, signature }); setError(""); }}><Check className="h-4 w-4" />Assinar</Button>)}
              {document.currentVersion && <Button variant="ghost" size="icon" aria-label={`Baixar ${document.title}`} disabled={busy || documents.isPlaceholderData} onClick={() => void download(document)}><Download className="h-4 w-4" /></Button>}
              {canManage && <Button variant="ghost" size="icon" aria-label={`Enviar nova versão de ${document.title}`} disabled={busy || documents.isPlaceholderData || document.status === "ARCHIVED"} onClick={() => { setUploadFor(document); setError(""); }}><Upload className="h-4 w-4" /></Button>}
            </div>
          </td>
        </tr>;
      })}</tbody></table></div> : null}
      {data && !documents.isError && <div className="flex flex-col gap-4 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">{data.total ? `${formatNumber((page - 1) * pageSize + 1)}–${formatNumber(Math.min(page * pageSize, data.total))} de ${formatNumber(data.total)} documentos` : "0 documentos"}</p><div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{page} / {pages}</span><Button variant="outline" size="icon" className="h-9 w-9" aria-label="Página anterior" disabled={page <= 1 || documents.isFetching} onClick={() => setPage(value => value - 1)}><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" size="icon" className="h-9 w-9" aria-label="Próxima página" disabled={page >= pages || documents.isFetching} onClick={() => setPage(value => value + 1)}><ChevronRight className="h-4 w-4" /></Button></div></div>}
    </Card>

    <Dialog open={createOpen} onOpenChange={value => { if (!busy) setCreateOpen(value); }}>
      <DialogContent><DialogTitle className="pr-7 text-xl font-semibold">Novo documento</DialogTitle><DialogDescription className="mt-2 text-sm text-muted-foreground">O documento nasce como rascunho; envie a primeira versão em PDF/Office logo depois.</DialogDescription>
        <form className="mt-5 space-y-4" onSubmit={async event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setBusy(true); setError("");
          try {
            const body: Record<string, unknown> = { title: String(form.get("title") ?? ""), kind: String(form.get("kind") ?? "") };
            const templateId = form.get("templateId");
            if (templateId) body.templateId = String(templateId);
            await api<DocumentView>("/documents", { method: "POST", body });
            setCreateOpen(false); setNotice("Documento criado com sucesso."); refresh();
          } catch (cause) { setError(errorMessage(cause)); }
          finally { setBusy(false); }
        }}>
          <label className="block space-y-1.5 text-sm font-medium">Título<Input name="title" required minLength={2} maxLength={200} className="mt-1 font-normal" placeholder="Ex.: Contrato de experiência — Maria" /></label>
          <label className="block space-y-1.5 text-sm font-medium">Tipo<select name="kind" className="mt-1 h-11 w-full rounded-md border bg-card px-3 text-sm font-normal">{(Object.keys(kindLabels) as DocumentKind[]).map(value => <option key={value} value={value}>{kindLabels[value]}</option>)}</select></label>
          <TemplateSelect />
          <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setCreateOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Criar documento"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(uploadFor)} onOpenChange={value => { if (!busy && !value) setUploadFor(undefined); }}>
      <DialogContent><DialogTitle className="pr-7 text-xl font-semibold">Nova versão</DialogTitle><DialogDescription className="mt-2 text-sm text-muted-foreground">{uploadFor?.title} — aceita PDF, imagens e arquivos Office (limite do servidor aplicado no upload).</DialogDescription>
        <form className="mt-5 space-y-4" onSubmit={async event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setBusy(true); setError("");
          try {
            await apiUpload<VersionView>(`/documents/${uploadFor!.id}/versions`, form);
            setUploadFor(undefined); setNotice("Versão enviada com sucesso."); refresh();
          } catch (cause) { setError(errorMessage(cause)); }
          finally { setBusy(false); }
        }}>
          <label className="block space-y-1.5 text-sm font-medium">Arquivo<input name="file" type="file" required className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-primary" /></label>
          <label className="block space-y-1.5 text-sm font-medium">Nota (opcional)<Input name="note" maxLength={500} className="mt-1 font-normal" placeholder="Ex.: assinatura digitalizada" /></label>
          <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setUploadFor(undefined)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Enviando…" : "Enviar versão"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(signFor)} onOpenChange={value => { if (!busy && !value) setSignFor(undefined); }}>
      <DialogContent><DialogTitle className="pr-7 text-xl font-semibold">Registrar assinatura manual</DialogTitle><DialogDescription className="mt-2 text-sm text-muted-foreground">{signFor?.document.title} — assinatura como {signFor ? signatureRoleLabels[signFor.signature.role] : ""}. A evidência (método, user-agent e hash) é gravada de forma imutável.</DialogDescription>
        <form className="mt-5 space-y-4" onSubmit={async event => {
          event.preventDefault();
          setBusy(true); setError("");
          try {
            await api<SignatureView>(`/documents/signatures/${signFor!.signature.id}/sign`, { method: "POST", body: { evidence: { userAgent: navigator.userAgent, sha256: signFor!.document.currentVersion?.file?.sha256 ?? null } } });
            setSignFor(undefined); setNotice("Assinatura registrada."); refresh();
          } catch (cause) { setError(errorMessage(cause)); }
          finally { setBusy(false); }
        }}>
          <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setSignFor(undefined)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Registrando…" : "Confirmar assinatura"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}

function TemplateSelect() {
  const user = useUser();
  const templates = useQuery({ queryKey: ["document-templates", user.companyId], queryFn: ({ signal }) => api<{ items: TemplateView[] }>("/documents/templates", { signal }), enabled: user.role === "ADMIN" || user.role === "HR" });
  if (!templates.data || templates.data.items.length === 0) return null;
  return <label className="block space-y-1.5 text-sm font-medium">Modelo (opcional)<select name="templateId" className="mt-1 h-11 w-full rounded-md border bg-card px-3 text-sm font-normal"><option value="">Sem modelo</option>{templates.data.items.filter(t => t.isActive).map(template => <option key={template.id} value={template.id}>{template.name} ({template.code})</option>)}</select></label>;
}
