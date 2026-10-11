"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import { ApiError } from "@/lib/api";

type RecoveryState = { codes: string[] | null; setCodes: (codes: string[] | null) => void };
const RecoveryContext = createContext<RecoveryState | null>(null);
export function useRecoveryCodes() { const value = useContext(RecoveryContext); if (!value) throw new Error("Contexto de recuperação indisponível."); return value; }

export function Providers({ children, nonce }: { children: ReactNode; nonce?: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30000, retry: (attempt, error) => !(error instanceof ApiError && error.status < 500) && attempt < 1, refetchOnWindowFocus: true } } }));
  const [codes, setCodes] = useState<string[] | null>(null);
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current === "/recuperacao" && pathname !== "/recuperacao") setCodes(null);
    previousPath.current = pathname;
  }, [pathname]);
  return <RecoveryContext.Provider value={{ codes, setCodes }}><QueryClientProvider client={client}><ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}><MotionConfig reducedMotion="user">{children}</MotionConfig></ThemeProvider></QueryClientProvider></RecoveryContext.Provider>;
}
