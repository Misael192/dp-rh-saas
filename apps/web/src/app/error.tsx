"use client";
import { ErrorState } from "@/components/ui/feedback";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <ErrorState message="Não foi possível exibir esta página. Tente carregá-la novamente." onRetry={reset} />; }
