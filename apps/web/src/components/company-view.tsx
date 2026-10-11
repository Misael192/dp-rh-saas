"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Building2, ShieldCheck, ArrowUpRight } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { Company } from "@/lib/types";
import { useUser } from "./authenticated-shell";
import { PageHeading } from "./page-heading";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { EmptyState, ErrorState, LoadingState } from "./ui/feedback";
export function CompanyView() {
  const user = useUser();
  const companies = useQuery({ queryKey: ["company", user.companyId], queryFn: ({ signal }) => api<{ items: Company[] }>("/companies", { signal }) });
  const company = companies.data?.items.find(item => item.id === user.companyId);
  return <><PageHeading eyebrow="Organização" title="Minha empresa" description="Confira o contexto do seu workspace e os dados disponíveis para esta etapa." /><div className="grid gap-6 lg:grid-cols-[1fr_330px]"><Card className="p-6">{companies.isPending ? <LoadingState /> : companies.isError ? <ErrorState message={errorMessage(companies.error)} onRetry={() => void companies.refetch()} /> : !company ? <EmptyState title="Empresa indisponível" description="A empresa atual não foi encontrada. Entre novamente ou consulte o administrador." /> : <><div className="mb-6 flex items-center gap-4"><span className="rounded-xl bg-primary/10 p-4 text-primary"><Building2 className="h-6 w-6" /></span><div><h2 className="text-xl font-semibold">{company.name}</h2><p className="mt-1 text-sm text-muted-foreground">{user.tenantName}</p></div></div><dl className="divide-y"><div className="flex flex-col gap-2 py-4 sm:flex-row sm:justify-between"><dt className="text-sm text-muted-foreground">Nome da empresa</dt><dd className="text-sm font-medium">{company.name}</dd></div><div className="flex flex-col gap-2 py-4 sm:flex-row sm:justify-between"><dt className="text-sm text-muted-foreground">Identificador de acesso</dt><dd className="text-sm font-medium">{company.slug}</dd></div><div className="flex flex-col gap-2 py-4 sm:flex-row sm:justify-between"><dt className="text-sm text-muted-foreground">Organização</dt><dd className="text-sm font-medium">{user.tenantName}</dd></div></dl><p className="mt-5 rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground">A edição cadastral de empresas, filiais e configurações será disponibilizada em uma etapa posterior.</p></>}</Card><Card className="h-fit p-6"><ShieldCheck className="h-6 w-6 text-primary" /><h2 className="mt-4 font-semibold">Um acesso, uma empresa</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Sua sessão está vinculada a esta empresa. Para acessar outro workspace, encerre a sessão e entre com o identificador correspondente.</p><Button variant="outline" className="mt-6 w-full" asChild><Link href="/seguranca">Segurança da conta<ArrowUpRight className="h-4 w-4" /></Link></Button></Card></div></>;
}
