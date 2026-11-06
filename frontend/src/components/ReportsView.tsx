"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Icons } from "./Icons";
import { getApiUrl, getAuthHeaders } from "@/utils/api";

interface KpiData {
  anio: number | null;
  mes: number | null;
  total_compras: number;
  total_comprobantes: number;
  total_iva_credito: number;
  total_percepciones: number;
  total_neto: number;
  ticket_promedio: number;
}

interface MonthlyIva {
  mes: number;
  mes_nombre: string;
  credito_fiscal: number;
  debito_fiscal: number;
  saldo_mes: number;
  total_compras: number;
  cantidad_facturas: number;
}

interface TopSupplier {
  razon_social: string;
  cuit_emisor: string;
  total_acumulado: number;
  total_iva: number;
  cantidad_comprobantes: number;
  porcentaje: number;
}

interface JurisdictionPerception {
  jurisdiccion: string;
  total_iibb: number;
  total_iva: number;
  total_percepciones: number;
  cantidad_comprobantes: number;
  porcentaje_iibb: number;
}

const MONTHS = [
  { value: 0, label: "Todos los meses (Anual)" },
  { value: 1, label: "Enero" },
  { value: 2, label: "Febrero" },
  { value: 3, label: "Marzo" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Mayo" },
  { value: 6, label: "Junio" },
  { value: 7, label: "Julio" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Septiembre" },
  { value: 10, label: "Octubre" },
  { value: 11, label: "Noviembre" },
  { value: 12, label: "Diciembre" },
];

const YEARS = [2026, 2025, 2024, 2023];

export const ReportsView: React.FC = () => {
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(0); // 0 = Todos
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hoveredMonth, setHoveredMonth] = useState<MonthlyIva | null>(null);

  const [kpis, setKpis] = useState<KpiData>({
    anio: null,
    mes: null,
    total_compras: 0,
    total_comprobantes: 0,
    total_iva_credito: 0,
    total_percepciones: 0,
    total_neto: 0,
    ticket_promedio: 0,
  });

  const [monthlyEvolution, setMonthlyEvolution] = useState<MonthlyIva[]>([]);
  const [topSuppliers, setTopSuppliers] = useState<TopSupplier[]>([]);
  const [jurisdictions, setJurisdictions] = useState<JurisdictionPerception[]>([]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
    }).format(val);
  };

  const formatCuit = (cuit: string) => {
    const clean = cuit.replace(/\D/g, "");
    if (clean.length === 11) {
      return `${clean.substring(0, 2)}-${clean.substring(2, 10)}-${clean.substring(10, 11)}`;
    }
    return cuit;
  };

  const loadReports = useCallback(async () => {
    setIsLoading(true);
    try {
      const queryParams = new URLSearchParams();
      queryParams.append("anio", selectedYear.toString());
      if (selectedMonth > 0) {
        queryParams.append("mes", selectedMonth.toString());
      }

      const apiUrl = getApiUrl();
      const headers = getAuthHeaders({ "Content-Type": "application/json" });

      const [kpisRes, evolutionRes, suppliersRes, jurisdictionsRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/reports/kpis?${queryParams.toString()}`, { headers }),
        fetch(`${apiUrl}/api/v1/reports/evolucion-iva?anio=${selectedYear}`, { headers }),
        fetch(`${apiUrl}/api/v1/reports/proveedores-top?${queryParams.toString()}&limit=5`, { headers }),
        fetch(`${apiUrl}/api/v1/reports/percepciones-jurisdiccion?${queryParams.toString()}`, { headers }),
      ]);

      if (kpisRes.ok) {
        const data = await kpisRes.json();
        setKpis(data);
      }
      if (evolutionRes.ok) {
        const data = await evolutionRes.json();
        setMonthlyEvolution(data);
      }
      if (suppliersRes.ok) {
        const data = await suppliersRes.json();
        setTopSuppliers(data);
      }
      if (jurisdictionsRes.ok) {
        const data = await jurisdictionsRes.json();
        setJurisdictions(data);
      }
    } catch (err) {
      console.error("Error al cargar datos del módulo de reportes:", err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  // Exportar reporte consolidado a CSV compatible con Excel
  const handleExportCsv = () => {
    const periodLabel = selectedMonth > 0 ? `${MONTHS[selectedMonth].label}_${selectedYear}` : `Anual_${selectedYear}`;
    let csvContent = "\uFEFF"; // BOM UTF-8

    // Sección 1: KPIs
    csvContent += "=== REPORTE EJECUTIVO OIKONOMIAS ===\n";
    csvContent += `Período;${periodLabel}\n`;
    csvContent += `Total Compras;${kpis.total_compras}\n`;
    csvContent += `Neto Gravado;${kpis.total_neto}\n`;
    csvContent += `IVA Crédito Fiscal;${kpis.total_iva_credito}\n`;
    csvContent += `Percepciones Totales (IIBB + IVA);${kpis.total_percepciones}\n`;
    csvContent += `Comprobantes Procesados;${kpis.total_comprobantes}\n`;
    csvContent += `Ticket Promedio;${kpis.ticket_promedio}\n\n`;

    // Sección 2: Top Proveedores
    csvContent += "=== TOP PROVEEDORES ===\n";
    csvContent += "Razón Social;CUIT;Total Acumulado ($);IVA ($);Comprobantes;% Participación\n";
    topSuppliers.forEach((s) => {
      csvContent += `"${s.razon_social}";"${s.cuit_emisor}";${s.total_acumulado};${s.total_iva};${s.cantidad_comprobantes};${s.porcentaje}%\n`;
    });
    csvContent += "\n";

    // Sección 3: Percepciones por Jurisdicción
    csvContent += "=== PERCEPCIONES POR JURISDICCIÓN (CONVENIO MULTILATERAL) ===\n";
    csvContent += "Jurisdicción;Percepción IIBB ($);Percepción IVA ($);Total Percepciones ($);Comprobantes;% IIBB\n";
    jurisdictions.forEach((j) => {
      csvContent += `"${j.jurisdiccion}";${j.total_iibb};${j.total_iva};${j.total_percepciones};${j.cantidad_comprobantes};${j.porcentaje_iibb}%\n`;
    });
    csvContent += "\n";

    // Sección 4: Evolución Mensual
    csvContent += `=== EVOLUCIÓN MENSUAL IVA ${selectedYear} ===\n`;
    csvContent += "Mes;Crédito Fiscal IVA ($);Débito Fiscal ($);Saldo Mes ($);Total Compras ($);Facturas\n";
    monthlyEvolution.forEach((m) => {
      csvContent += `${m.mes_nombre};${m.credito_fiscal};${m.debito_fiscal};${m.saldo_mes};${m.total_compras};${m.cantidad_facturas}\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `reporte_fiscal_oikonomias_${periodLabel.toLowerCase()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Cálculo de escala para el gráfico SVG
  const maxCredito = Math.max(...monthlyEvolution.map((m) => m.credito_fiscal), 100);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* 1. Header con Filtros y Acciones */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Reportes Financieros y Fiscales
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Métricas fiscales agregadas en tiempo real sin consumo de cuota de IA.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Selector de Año */}
          <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 shadow-xs">
            <Icons.Calendar className="h-4 w-4 text-slate-400" />
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-transparent text-sm font-semibold text-slate-700 outline-none"
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Selector de Mes */}
          <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 shadow-xs">
            <Icons.Filter className="h-4 w-4 text-slate-400" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="bg-transparent text-sm font-medium text-slate-700 outline-none"
            >
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Botón Refrescar */}
          <button
            type="button"
            onClick={loadReports}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white p-2.5 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 shadow-xs disabled:opacity-50"
            title="Actualizar datos"
          >
            <Icons.Refresh className={`h-4 w-4 ${isLoading ? "animate-spin text-emerald-600" : ""}`} />
          </button>

          {/* Botón Exportar CSV */}
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-emerald-600/20 transition hover:bg-emerald-700"
          >
            <Icons.Download className="h-4 w-4" />
            <span>Exportar Reporte (CSV)</span>
          </button>
        </div>
      </div>

      {/* 2. Tarjetas de Métricas Clave (KPIs) */}
      <div className="mb-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1: Total Compras */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Compras
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Icons.FileText className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold tracking-tight text-slate-900">
              {formatCurrency(kpis.total_compras)}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Neto gravado: <span className="font-semibold text-slate-700">{formatCurrency(kpis.total_neto)}</span>
            </p>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-blue-500" />
        </div>

        {/* KPI 2: IVA Crédito Fiscal */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              IVA Crédito Fiscal
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Icons.Calculator className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold tracking-tight text-emerald-600">
              {formatCurrency(kpis.total_iva_credito)}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Computable para Liquidación F. 2002
            </p>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-emerald-500" />
        </div>

        {/* KPI 3: Percepciones */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Percepciones Pagadas
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Icons.Landmark className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold tracking-tight text-slate-900">
              {formatCurrency(kpis.total_percepciones)}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Ingresos Brutos e IVA en compras
            </p>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-amber-500" />
        </div>

        {/* KPI 4: Comprobantes y Ticket Promedio */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Comprobantes Procesados
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
              <Icons.TrendingUp className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold tracking-tight text-slate-900">
              {kpis.total_comprobantes} <span className="text-sm font-normal text-slate-500">facturas</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Ticket Promedio: <span className="font-semibold text-slate-700">{formatCurrency(kpis.ticket_promedio)}</span>
            </p>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-purple-500" />
        </div>
      </div>

      {/* 3. Gráfico de Evolución Mensual de Crédito Fiscal IVA */}
      <div className="mb-8 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
        <div className="mb-6 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Evolución Mensual del Crédito Fiscal IVA ({selectedYear})
            </h2>
            <p className="text-xs text-slate-500">
              Comportamiento del crédito fiscal acumulado por mes imputado.
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs font-medium text-slate-600">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-emerald-500" />
              <span>Crédito Fiscal Compras</span>
            </div>
            {hoveredMonth && (
              <div className="rounded-lg bg-slate-900 px-2.5 py-1 text-white shadow-sm">
                <span className="font-semibold">{hoveredMonth.mes_nombre}:</span>{" "}
                {formatCurrency(hoveredMonth.credito_fiscal)} ({hoveredMonth.cantidad_facturas} facturas)
              </div>
            )}
          </div>
        </div>

        {/* Renderizado de Gráfico de Barras SVG */}
        <div className="relative h-64 w-full">
          {monthlyEvolution.length === 0 || monthlyEvolution.every((m) => m.credito_fiscal === 0) ? (
            <div className="flex h-full flex-col items-center justify-center text-slate-400">
              <Icons.Calculator className="mb-2 h-8 w-8 stroke-1 text-slate-300" />
              <p className="text-sm">Sin comprobantes registrados para el año {selectedYear}</p>
            </div>
          ) : (
            <div className="flex h-full items-end gap-2 pt-6 pb-8 sm:gap-4">
              {monthlyEvolution.map((item) => {
                const heightPercentage = Math.max(
                  Math.round((item.credito_fiscal / maxCredito) * 100),
                  item.credito_fiscal > 0 ? 6 : 0
                );

                return (
                  <div
                    key={item.mes}
                    className="group relative flex flex-1 flex-col items-center h-full justify-end"
                    onMouseEnter={() => setHoveredMonth(item)}
                    onMouseLeave={() => setHoveredMonth(null)}
                  >
                    {/* Barra */}
                    <div
                      style={{ height: `${heightPercentage}%` }}
                      className={`w-full max-w-[42px] rounded-t-lg transition-all duration-300 ${
                        item.credito_fiscal > 0
                          ? "bg-emerald-500 group-hover:bg-emerald-600 shadow-xs"
                          : "bg-slate-100"
                      }`}
                    />

                    {/* Etiqueta de Mes */}
                    <span className="absolute -bottom-6 text-xs font-medium text-slate-500 group-hover:text-slate-900">
                      {item.mes_nombre}
                    </span>

                    {/* Tooltip flotante en hover */}
                    {item.credito_fiscal > 0 && (
                      <div className="pointer-events-none absolute -top-10 z-10 hidden whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover:block">
                        {formatCurrency(item.credito_fiscal)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 4. Tablas Inferiores: Top Proveedores & Jurisdicciones de IIBB */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Tabla: Top 5 Proveedores */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Top 5 Proveedores
              </h2>
              <p className="text-xs text-slate-500">
                Por volumen acumulado en compras en el período seleccionado.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
              {topSuppliers.length} emisores
            </span>
          </div>

          <div className="overflow-x-auto">
            {topSuppliers.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">
                No hay compras registradas en este período.
              </div>
            ) : (
              <div className="space-y-4">
                {topSuppliers.map((sup, idx) => (
                 <div key={`${sup.cuit_emisor}-${idx}`} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">
                          {idx + 1}
                        </span>
                        <div>
                          <div className="font-semibold text-slate-800 line-clamp-1">
                            {sup.razon_social}
                          </div>
                          <div className="text-xs text-slate-500 font-mono">
                            CUIT: {formatCuit(sup.cuit_emisor)} • {sup.cantidad_comprobantes} fact.
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-slate-900">
                          {formatCurrency(sup.total_acumulado)}
                        </div>
                        <div className="text-[11px] text-emerald-600 font-medium">
                          {sup.porcentaje}% del total
                        </div>
                      </div>
                    </div>

                    {/* Barra de Progreso Porcentual */}
                    <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(sup.porcentaje, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tabla: Desglose de Percepciones por Jurisdicción */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Percepciones por Jurisdicción
              </h2>
              <p className="text-xs text-slate-500">
                Ingresos Brutos y percepciones para Convenio Multilateral (Sifere).
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
              {jurisdictions.length} prov.
            </span>
          </div>

          <div className="overflow-x-auto">
            {jurisdictions.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">
                No se registraron percepciones de IIBB ni IVA en el período.
              </div>
            ) : (
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="py-2.5 px-3">Jurisdicción</th>
                    <th className="py-2.5 px-3 text-right">IIBB ($)</th>
                    <th className="py-2.5 px-3 text-right">IVA ($)</th>
                    <th className="py-2.5 px-3 text-right">Total ($)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {jurisdictions.map((j) => (
                    <tr key={j.jurisdiccion} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-3 font-medium text-slate-800">
                        {j.jurisdiccion}
                        <div className="text-[10px] text-slate-400">
                          {j.cantidad_comprobantes} comprobantes
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-semibold text-slate-700">
                        {formatCurrency(j.total_iibb)}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-600">
                        {formatCurrency(j.total_iva)}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-slate-900">
                        {formatCurrency(j.total_percepciones)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

