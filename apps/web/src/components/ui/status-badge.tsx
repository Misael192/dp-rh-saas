import type { EmployeeStatus } from "@/lib/types";
import { statusLabels } from "@/lib/types";
import { cn } from "@/lib/utils";
export function StatusBadge({ status }: { status: EmployeeStatus }) { return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : status === "ON_LEAVE" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground")}><span className="h-1.5 w-1.5 rounded-full bg-current" />{statusLabels[status]}</span>; }
