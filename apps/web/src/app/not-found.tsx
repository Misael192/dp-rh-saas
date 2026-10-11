import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function NotFound() { return <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6"><p className="text-sm font-medium text-primary">404</p><h1 className="text-2xl font-semibold">Página não encontrada</h1><p className="text-sm text-muted-foreground">Confira o endereço ou retorne ao seu workspace.</p><Button asChild><Link href="/dashboard">Ir para visão geral</Link></Button></main>; }
