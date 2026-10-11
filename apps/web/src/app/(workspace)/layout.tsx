import { AuthenticatedShell } from "@/components/authenticated-shell";
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) { return <AuthenticatedShell>{children}</AuthenticatedShell>; }
