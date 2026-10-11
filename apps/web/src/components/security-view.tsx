"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { QRCodeSVG } from "qrcode.react";
import { KeyRound, LoaderCircle, ShieldCheck, Smartphone } from "lucide-react";
import { api, clearApiSession, errorMessage } from "@/lib/api";
import { roles } from "@/lib/types";
import { useUser } from "./authenticated-shell";
import { useRecoveryCodes } from "./providers";
import { PageHeading } from "./page-heading";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { FormError } from "./ui/feedback";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const currentPassword = z.string().min(1, "Informe sua senha atual.").max(128);
const passwordSchema = z.object({ currentPassword, newPassword: z.string().min(12, "Use pelo menos 12 caracteres.").max(128, "Use até 128 caracteres."), confirmPassword: z.string() }).refine(values => values.newPassword === values.confirmPassword, { message: "As senhas não coincidem.", path: ["confirmPassword"] });
const setupSchema = z.object({ currentPassword });
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/, "Informe o código de seis dígitos.") });
const disableSchema = z.object({ currentPassword, code: z.string().regex(/^(?:\d{6}|(?:[a-fA-F0-9]{4}-){7}[a-fA-F0-9]{4})$/, "Informe o código do autenticador ou um código de recuperação válido.") });

function PasswordForm() {
  const router = useRouter();
  const client = useQueryClient();
  const form = useForm<z.infer<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema), defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" } });
  const change = useMutation({ mutationFn: (values: z.infer<typeof passwordSchema>) => api<void>("/auth/change-password", { method: "POST", body: { currentPassword: values.currentPassword, newPassword: values.newPassword } }), onSuccess: () => { client.clear(); clearApiSession(); router.replace("/login?updated=password"); } });
  const errors = form.formState.errors;
  return <form noValidate onSubmit={form.handleSubmit(values => change.mutate(values))} className="mt-5 space-y-4">{[{ name: "currentPassword" as const, label: "Senha atual", autoComplete: "current-password" }, { name: "newPassword" as const, label: "Nova senha", autoComplete: "new-password" }, { name: "confirmPassword" as const, label: "Confirmar nova senha", autoComplete: "new-password" }].map(field => <div key={field.name} className="space-y-2"><Label htmlFor={`password-${field.name}`}>{field.label}</Label><Input id={`password-${field.name}`} type="password" autoComplete={field.autoComplete} disabled={change.isPending} aria-invalid={!!errors[field.name]} aria-describedby={errors[field.name] ? `password-${field.name}-error` : undefined} {...form.register(field.name)} /><FormError id={`password-${field.name}-error`} message={errors[field.name]?.message} /></div>)}<p className="text-xs leading-relaxed text-muted-foreground">Use pelo menos 12 caracteres. Após a alteração, todas as sessões serão encerradas e você entrará novamente.</p><FormError message={change.isError ? errorMessage(change.error) : undefined} /><Button type="submit" disabled={change.isPending}>{change.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}{change.isPending ? "Alterando…" : "Alterar senha"}</Button></form>;
}

function MfaSetup() {
  const router = useRouter();
  const client = useQueryClient();
  const recovery = useRecoveryCodes();
  const [uri, setUri] = useState<string | null>(null);
  const setupForm = useForm<z.infer<typeof setupSchema>>({ resolver: zodResolver(setupSchema), defaultValues: { currentPassword: "" } });
  const codeForm = useForm<z.infer<typeof codeSchema>>({ resolver: zodResolver(codeSchema), defaultValues: { code: "" } });
  const setup = useMutation({ mutationFn: (values: z.infer<typeof setupSchema>) => api<{ otpauthUri: string }>("/auth/mfa/setup", { method: "POST", body: values }), onSuccess: data => { setUri(data.otpauthUri); setupForm.reset(); codeForm.reset(); } });
  const enable = useMutation({ mutationFn: (values: z.infer<typeof codeSchema>) => api<{ recoveryCodes: string[] }>("/auth/mfa/enable", { method: "POST", body: values }), onSuccess: data => { recovery.setCodes(data.recoveryCodes); setUri(null); codeForm.reset(); client.clear(); clearApiSession(); router.replace("/recuperacao"); } });
  const manualKey = uri ? new URL(uri).searchParams.get("secret") : null;
  if (!uri) return <form noValidate onSubmit={setupForm.handleSubmit(values => setup.mutate(values))} className="mt-5 space-y-4"><p className="text-sm leading-relaxed text-muted-foreground">Confirme sua senha para gerar a configuração. Depois, adicione sua conta a um aplicativo autenticador.</p><div className="space-y-2"><Label htmlFor="mfa-setup-password">Senha atual</Label><Input id="mfa-setup-password" type="password" autoComplete="current-password" disabled={setup.isPending} aria-invalid={!!setupForm.formState.errors.currentPassword} aria-describedby="mfa-setup-password-error" {...setupForm.register("currentPassword")} /><FormError id="mfa-setup-password-error" message={setupForm.formState.errors.currentPassword?.message} /></div><FormError message={setup.isError ? errorMessage(setup.error) : undefined} /><Button type="submit" disabled={setup.isPending}>{setup.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}{setup.isPending ? "Preparando…" : "Configurar dois fatores"}</Button></form>;
  return <div className="mt-5 space-y-5"><div><h3 className="text-sm font-semibold">1. Adicione a conta ao autenticador</h3><p className="mt-2 text-sm text-muted-foreground">Escaneie este QR Code com seu aplicativo. A configuração expira em 10 minutos.</p><div className="mx-auto mt-5 w-fit rounded-lg border bg-white p-4"><QRCodeSVG value={uri} size={184} level="M" title="QR Code de configuração do autenticador PeopleFlow" /></div><details className="mt-4 text-sm"><summary className="w-fit cursor-pointer text-primary">Digitar a chave manualmente</summary><p className="mt-3 text-xs text-muted-foreground">Guarde esta chave como uma senha. Não compartilhe.</p><code className="mt-2 block select-all break-all rounded-md bg-muted p-3 text-xs">{manualKey}</code></details></div><form noValidate onSubmit={codeForm.handleSubmit(values => enable.mutate(values))} className="space-y-4"><div className="space-y-2"><Label htmlFor="mfa-enable-code">2. Confirme o código de seis dígitos</Label><Input id="mfa-enable-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" disabled={enable.isPending} aria-invalid={!!codeForm.formState.errors.code} aria-describedby="mfa-enable-code-error" {...codeForm.register("code")} /><FormError id="mfa-enable-code-error" message={codeForm.formState.errors.code?.message} /></div><p className="text-xs leading-relaxed text-muted-foreground">A ativação encerra todas as sessões. Em seguida, você receberá os códigos de recuperação e entrará novamente.</p><FormError message={enable.isError ? errorMessage(enable.error) : undefined} /><div className="flex flex-wrap gap-3"><Button type="submit" disabled={enable.isPending}>{enable.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}{enable.isPending ? "Ativando…" : "Ativar dois fatores"}</Button><Button type="button" variant="outline" disabled={enable.isPending} onClick={() => { setUri(null); codeForm.reset(); enable.reset(); }}>Reiniciar configuração</Button></div></form></div>;
}

function MfaDisable() {
  const router = useRouter();
  const client = useQueryClient();
  const form = useForm<z.infer<typeof disableSchema>>({ resolver: zodResolver(disableSchema), defaultValues: { currentPassword: "", code: "" } });
  const disable = useMutation({ mutationFn: (values: z.infer<typeof disableSchema>) => api<void>("/auth/mfa/disable", { method: "POST", body: values }), onSuccess: () => { client.clear(); clearApiSession(); router.replace("/login?updated=mfa-disabled"); } });
  const errors = form.formState.errors;
  return <form noValidate onSubmit={form.handleSubmit(values => disable.mutate(values))} className="mt-5 space-y-4"><p className="text-sm leading-relaxed text-muted-foreground">Sua conta está protegida com dois fatores. Para desativar, confirme sua senha e um código válido. Todas as sessões serão encerradas.</p><div className="space-y-2"><Label htmlFor="mfa-disable-password">Senha atual</Label><Input id="mfa-disable-password" type="password" autoComplete="current-password" disabled={disable.isPending} aria-invalid={!!errors.currentPassword} aria-describedby="mfa-disable-password-error" {...form.register("currentPassword")} /><FormError id="mfa-disable-password-error" message={errors.currentPassword?.message} /></div><div className="space-y-2"><Label htmlFor="mfa-disable-code">Código do autenticador ou de recuperação</Label><Input id="mfa-disable-code" autoComplete="one-time-code" maxLength={39} disabled={disable.isPending} aria-invalid={!!errors.code} aria-describedby="mfa-disable-code-error" {...form.register("code")} /><FormError id="mfa-disable-code-error" message={errors.code?.message} /></div><FormError message={disable.isError ? errorMessage(disable.error) : undefined} /><Button type="submit" variant="outline" disabled={disable.isPending}>{disable.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}{disable.isPending ? "Desativando…" : "Desativar dois fatores"}</Button></form>;
}

export function SecurityView() {
  const user = useUser();
  return <><PageHeading eyebrow="Minha conta" title="Segurança" description="Proteja seu acesso e gerencie suas credenciais." /><Card className="mb-6 p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{user.name}</p><p className="mt-1 text-sm text-muted-foreground">{user.email}</p></div><span className="w-fit rounded-full border bg-muted px-3 py-1.5 text-xs font-medium">{roles[user.role]}</span></div></Card><div className="grid items-start gap-6 lg:grid-cols-2"><Card className="p-6"><span className="inline-flex rounded-lg bg-primary/10 p-2.5 text-primary"><KeyRound className="h-5 w-5" /></span><h2 className="mt-4 text-lg font-semibold">Senha de acesso</h2><p className="mt-2 text-sm text-muted-foreground">Mantenha uma senha forte e exclusiva para esta conta.</p><PasswordForm /></Card><Card className="p-6"><div className="flex items-start justify-between gap-3"><span className="inline-flex rounded-lg bg-primary/10 p-2.5 text-primary"><Smartphone className="h-5 w-5" /></span><span className={`rounded-full px-3 py-1 text-xs font-medium ${user.mfaEnabled ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>{user.mfaEnabled ? "Ativado" : "Não ativado"}</span></div><h2 className="mt-4 text-lg font-semibold">Autenticação em dois fatores</h2><p className="mt-2 text-sm text-muted-foreground">Adicione uma camada de proteção ao seu login.</p>{user.mfaEnabled ? <MfaDisable /> : <MfaSetup />}</Card></div><p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0" />Alterações de senha e dois fatores encerram as sessões em todos os dispositivos.</p></>;
}
