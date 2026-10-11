"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { employeeCreateSchema } from "@peopleflow/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { Employee } from "@/lib/types";
import { useUser } from "./authenticated-shell";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { FormError } from "./ui/feedback";

const schema = employeeCreateSchema.extend({
  registration: z.string().trim().min(1, "Informe a matrícula.").max(40, "Use até 40 caracteres."),
  fullName: z.string().trim().min(2, "Informe o nome completo.").max(160, "Use até 160 caracteres."),
  email: z.string().trim().email("Informe um e-mail válido.").max(254).or(z.literal("")),
  jobTitle: z.string().trim().min(1, "Informe o cargo.").max(120),
  departmentName: z.string().trim().min(1, "Informe o departamento.").max(120),
  hiredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data de admissão.").refine(value => {
    const date = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Informe uma data válida."),
});
type Values = z.infer<typeof schema>;

export function EmployeeForm({ employee, onSaved, onCancel, onPendingChange }: { employee?: Employee; onSaved: () => void; onCancel: () => void; onPendingChange: (pending: boolean) => void }) {
  const user = useUser();
  const client = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: employee ? { registration: employee.registration, fullName: employee.fullName, email: employee.email ?? "", jobTitle: employee.jobTitle, departmentName: employee.departmentName, hiredAt: employee.hiredAt.slice(0, 10), status: employee.status } : { registration: "", fullName: "", email: "", jobTitle: "", departmentName: "", hiredAt: "", status: "ACTIVE" } });
  const save = useMutation({
    mutationFn: (values: Values) => api<Employee>(employee ? `/employees/${encodeURIComponent(employee.id)}` : "/employees", { method: employee ? "PATCH" : "POST", body: { ...values, email: values.email || null } }),
    onMutate: () => onPendingChange(true),
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ["employees", user.companyId] }), client.invalidateQueries({ queryKey: ["dashboard", user.companyId] })]);
      onSaved();
    },
    onSettled: () => onPendingChange(false),
  });
  const errors = form.formState.errors;
  const fields = [{ name: "fullName" as const, label: "Nome completo", placeholder: "Nome do colaborador", autoComplete: "name" }, { name: "registration" as const, label: "Matrícula", placeholder: "Identificador interno", autoComplete: "off" }, { name: "email" as const, label: "E-mail (opcional)", placeholder: "colaborador@empresa.com.br", autoComplete: "email" }, { name: "jobTitle" as const, label: "Cargo", placeholder: "Ex.: Analista de RH", autoComplete: "off" }, { name: "departmentName" as const, label: "Departamento", placeholder: "Ex.: Pessoas e Cultura", autoComplete: "off" }, { name: "hiredAt" as const, label: "Data de admissão", placeholder: "", autoComplete: "off" }];
  return <form noValidate onSubmit={form.handleSubmit(values => save.mutate(values))} className="mt-6 space-y-5"><div className="grid gap-4 sm:grid-cols-2">{fields.map(field => <div key={field.name} className={field.name === "fullName" ? "space-y-2 sm:col-span-2" : "space-y-2"}><Label htmlFor={`employee-${field.name}`}>{field.label}</Label><Input id={`employee-${field.name}`} type={field.name === "hiredAt" ? "date" : field.name === "email" ? "email" : "text"} placeholder={field.placeholder} autoComplete={field.autoComplete} disabled={save.isPending} aria-invalid={!!errors[field.name]} aria-describedby={errors[field.name] ? `${field.name}-error` : undefined} {...form.register(field.name)} /><FormError id={`${field.name}-error`} message={errors[field.name]?.message} /></div>)}<div className="space-y-2"><Label htmlFor="employee-status">Situação</Label><select id="employee-status" className="h-11 w-full rounded-md border bg-card px-3 text-sm" disabled={save.isPending} {...form.register("status")}><option value="ACTIVE">Ativo</option><option value="ON_LEAVE">Afastado</option><option value="TERMINATED">Desligado</option></select><FormError message={errors.status?.message} /></div></div>{employee && <p className="rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground">Para encerrar um vínculo, altere a situação para “Desligado”. O histórico cadastral é preservado.</p>}<FormError message={save.isError ? errorMessage(save.error) : undefined} /><div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={onCancel} disabled={save.isPending}>Cancelar</Button><Button type="submit" disabled={save.isPending}>{save.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}{save.isPending ? "Salvando…" : employee ? "Salvar alterações" : "Cadastrar colaborador"}</Button></div></form>;
}
