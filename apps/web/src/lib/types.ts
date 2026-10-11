import type { SessionUser, Role, Employee, EmployeeStatus, Page } from "@peopleflow/contracts";
export type { Role, Employee, EmployeeStatus, Dashboard } from "@peopleflow/contracts";
export type User = SessionUser;
export type EmployeePage = Page<Employee>;
export type Company = { id: string; name: string; slug: string };
export const roles: Record<Role, string> = { ADMIN: "Administrador", HR: "Recursos Humanos", MANAGER: "Gestor", EMPLOYEE: "Funcionário" };
export const statusLabels: Record<EmployeeStatus, string> = { ACTIVE: "Ativo", ON_LEAVE: "Afastado", TERMINATED: "Desligado" };
export function userHome(role: Role) { return role === "EMPLOYEE" ? "/colaboradores" : role === "MANAGER" ? "/seguranca" : "/dashboard"; }
export function mayAccess(role: Role, path: string) {
  if (path === "/dashboard") return role === "ADMIN" || role === "HR";
  if (path === "/colaboradores") return role !== "MANAGER";
  return path === "/empresa" || path === "/seguranca";
}
