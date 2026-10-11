import { Layers3 } from "lucide-react";
import { cn } from "@/lib/utils";
export function Brand({ className }: { className?: string }) { return <span className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Layers3 className="h-5 w-5" /></span><span>people<span className="text-primary">flow</span><span className="ml-1.5 align-top text-[9px] font-medium uppercase tracking-widest text-muted-foreground">rh</span></span></span>; }
