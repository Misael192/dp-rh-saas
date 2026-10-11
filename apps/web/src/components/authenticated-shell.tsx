"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Building2, ChevronDown, LayoutDashboard, LogOut, Menu, ShieldCheck, UsersRound, Sparkles, LockKeyhole } from "lucide-react";
import { api, ApiError, clearApiSession, errorMessage } from "@/lib/api";
import { mayAccess, roles, userHome, type User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { ErrorState, LoadingState } from "./ui/feedback";
import { useRecoveryCodes } from "./providers";

const UserContext = createContext<User | null>(null);
export function useUser() { const user = useContext(UserContext); if (!user) throw new Error("Sessão indisponível."); return user; }
const navigation = [{ href: "/dashboard", label: "Visão geral", icon: LayoutDashboard }, { href: "/colaboradores", label: "Colaboradores", icon: UsersRound }, { href: "/empresa", label: "Minha empresa", icon: Building2 }, { href: "/seguranca", label: "Segurança", icon: ShieldCheck }];

function Sidebar({ user, onNavigate }: { user: User; onNavigate?: () => void }) {
  const pathname = usePathname();
  return <div className="flex h-full flex-col"><Link href={userHome(user.role)} onClick={onNavigate} className="mb-8 inline-flex w-fit rounded-md"><Brand /></Link><div className="mb-6 rounded-lg border bg-background p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Empresa atual</p><p className="mt-1.5 flex items-center gap-2 text-sm font-semibold"><Building2 className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{user.companyName}</span><ChevronDown aria-hidden="true" className="ml-auto h-3.5 w-3.5 text-muted-foreground" /></p><p className="mt-1 truncate pl-6 text-xs text-muted-foreground">{user.tenantName}</p></div><p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Workspace</p><nav aria-label="Navegação principal" className="space-y-1">{navigation.filter(item => mayAccess(user.role, item.href)).map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={onNavigate} aria-current={pathname === href ? "page" : undefined} className={cn("flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition-colors", pathname === href ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Icon className="h-[18px] w-[18px]" />{label}</Link>)}</nav><div className="mt-8 px-3"><p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Próximas etapas</p><ul className="space-y-3 text-xs text-muted-foreground"><li className="flex items-center justify-between">Departamento pessoal<LockKeyhole className="h-3 w-3" /></li><li className="flex items-center justify-between">Talentos e desenvolvimento<LockKeyhole className="h-3 w-3" /></li><li className="flex items-center justify-between">Assistente de IA<Sparkles className="h-3 w-3" /></li></ul></div><div className="mt-auto pt-10"><div className="rounded-lg bg-primary/5 p-3"><p className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck className="h-4 w-4 text-primary" />Acesso por empresa</p><p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">Os dados exibidos seguem as permissões do seu perfil.</p></div><p className="mt-3 px-2 text-[10px] text-muted-foreground">PeopleFlow · Fundação da plataforma</p></div></div>;
}

export function AuthenticatedShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const client = useQueryClient();
  const recovery = useRecoveryCodes();
  const [drawer, setDrawer] = useState(false);
  const session = useQuery({ queryKey: ["session"], queryFn: ({ signal }) => api<{ user: User }>("/auth/me", { signal }), retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const logout = useMutation({ mutationFn: () => api<void>("/auth/logout", { method: "POST", retryAuth: false }), onSuccess: () => { recovery.setCodes(null); client.clear(); clearApiSession(); router.replace("/login"); } });
  useEffect(() => {
    const expired = () => { recovery.setCodes(null); client.clear(); router.replace(`/login?expired=1&next=${encodeURIComponent(pathname)}`); };
    window.addEventListener("peopleflow:session-expired", expired);
    return () => window.removeEventListener("peopleflow:session-expired", expired);
  }, [client, pathname, router]);
  useEffect(() => { if (session.error instanceof ApiError && session.error.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`); }, [session.error, pathname, router]);
  useEffect(() => { if (session.data && !mayAccess(session.data.user.role, pathname)) router.replace(userHome(session.data.user.role)); }, [session.data, pathname, router]);
  if (session.isPending || session.error instanceof ApiError && session.error.status === 401) return <LoadingState label="Preparando seu workspace…" />;
  if (!session.data) return <ErrorState message={errorMessage(session.error)} onRetry={() => void session.refetch()} />;
  const user = session.data.user;
  if (!mayAccess(user.role, pathname)) return <LoadingState label="Abrindo seu workspace…" />;
  return <UserContext.Provider value={user}><a className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:translate-y-0" href="#conteudo">Pular para conteúdo</a><aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-card px-5 py-6 lg:block"><Sidebar user={user} /></aside><div className="lg:pl-64"><header className="sticky top-0 z-20 flex h-[76px] items-center justify-between gap-3 border-b bg-card/95 px-4 backdrop-blur-md sm:px-8"><div className="flex min-w-0 items-center gap-3"><Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir navegação" onClick={() => setDrawer(true)}><Menu className="h-5 w-5" /></Button><div className="hidden text-sm text-muted-foreground sm:block">Workspace <span className="mx-2 text-border">/</span> <span className="font-medium text-foreground">{navigation.find(item => item.href === pathname)?.label ?? "PeopleFlow"}</span></div><span className="truncate text-sm font-semibold sm:hidden">{user.companyName}</span></div><div className="flex items-center gap-1 sm:gap-3"><ThemeToggle /><span className="mx-1 hidden h-6 w-px bg-border sm:block" /><div className="hidden text-right sm:block"><p className="text-sm font-medium">{user.name}</p><p className="text-xs text-muted-foreground">{roles[user.role]}</p></div><span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{user.name.split(" ").map(part => part[0]).slice(0, 2).join("")}</span><Button variant="ghost" size="icon" aria-label="Sair da conta" title="Sair da conta" disabled={logout.isPending} onClick={() => logout.mutate()}><LogOut className="h-4 w-4" /></Button></div></header>{logout.isError && <div role="alert" className="border-b bg-destructive/10 px-6 py-3 text-sm text-destructive">Não foi possível encerrar a sessão: {errorMessage(logout.error)}</div>}<main id="conteudo" tabIndex={-1} className="mx-auto max-w-[1440px] px-4 py-7 sm:px-8 sm:py-9">{children}</main></div><Dialog open={drawer} onOpenChange={setDrawer}><DialogContent className="inset-y-0 left-0 top-0 h-dvh max-h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 rounded-none p-5"><DialogTitle className="sr-only">Navegação do workspace</DialogTitle><DialogDescription className="sr-only">Acesse os módulos disponíveis na sua empresa.</DialogDescription><Sidebar user={user} onNavigate={() => setDrawer(false)} /></DialogContent></Dialog></UserContext.Provider>;
}
