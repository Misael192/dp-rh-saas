import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { LoadingState } from "@/components/ui/feedback";
export const metadata = { title: "Entrar" };
export default function LoginPage() { return <Suspense fallback={<LoadingState label="Preparando acesso…" />}><LoginForm /></Suspense>; }
