"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ShieldCheck } from "lucide-react";
import { useRecoveryCodes } from "./providers";
import { Brand } from "./brand";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Label } from "./ui/label";

export function RecoveryView() {
  const { codes, setCodes } = useRecoveryCodes();
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!codes || saved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [codes, saved]);
  async function copy() {
    try { await navigator.clipboard.writeText(codes!.join("\n")); setMessage("Códigos copiados. Guarde-os em um local seguro."); }
    catch { setMessage("Selecione e copie os códigos manualmente no campo abaixo."); }
  }
  return <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-7 px-5 py-10"><Brand className="self-center text-xl" /><Card className="p-6 sm:p-8"><ShieldCheck className="h-8 w-8 text-emerald-600 dark:text-emerald-400" /><h1 className="mt-5 text-2xl font-semibold">{codes ? "Dois fatores ativado" : "Códigos de recuperação"}</h1>{codes ? <><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Guarde estes códigos antes de continuar. Eles são exibidos uma única vez e permitem entrar se você perder acesso ao autenticador. Cada código funciona apenas uma vez.</p><div className="mt-6 space-y-2"><Label htmlFor="recovery-codes">Seus códigos de recuperação</Label><textarea id="recovery-codes" className="w-full resize-none rounded-md border bg-background p-3 font-mono text-xs leading-6" readOnly rows={10} value={codes.join("\n")} spellCheck={false} onFocus={event => event.target.select()} /></div><Button variant="outline" className="mt-3" onClick={() => void copy()}><Copy className="h-4 w-4" />Copiar códigos</Button>{message && <p role="status" className="mt-3 text-xs text-muted-foreground">{message}</p>}<label className="mt-6 flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={saved} onChange={event => setSaved(event.target.checked)} /><span>Guardei meus códigos em um local seguro.</span></label><p className="mt-4 rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground">Para entrar, aguarde o próximo código do autenticador (até 30 segundos) ou use um código de recuperação. O código usado para ativar não pode ser reutilizado.</p><Button className="mt-6 w-full" disabled={!saved} onClick={() => { setCodes(null); router.replace("/login?updated=mfa-enabled"); }}>Continuar para o login</Button></> : <><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Não há códigos disponíveis nesta sessão. Os códigos só são exibidos imediatamente após ativar os dois fatores.</p><Button className="mt-6" onClick={() => router.replace("/login")}>Ir para login</Button></>}</Card></main>;
}
