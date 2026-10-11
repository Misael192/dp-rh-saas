import type { Metadata } from "next";
import { headers } from "next/headers";
import { Providers } from "@/components/providers";
import "./globals.css";
export const metadata: Metadata = { title: { default: "PeopleFlow · Gestão de pessoas", template: "%s · PeopleFlow" }, description: "Workspace de Departamento Pessoal e Recursos Humanos.", robots: { index: false, follow: false } };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { const nonce = (await headers()).get("x-nonce") ?? undefined; return <html lang="pt-BR" suppressHydrationWarning><body><Providers nonce={nonce}>{children}</Providers></body></html>; }
