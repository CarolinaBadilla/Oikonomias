"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Icons } from "./Icons";
import { useAuth } from "@/context/AuthContext";
import { getAuthHeaders } from "@/utils/api";

interface ImputedVoucher {
  id: string;
  tipo_comprobante: string;
  punto_venta: number;
  numero_comprobante: number;
  fecha_emision: string;
  fecha_imputacion_iva: string;
  cuit_emisor: string;
  razon_social: string;
  cuit_receptor: string;
  moneda: string;
  tipo_cambio: number;
  neto_gravado: number;
  iva_monto: number;
  percepcion_iva: number;
  percepcion_iibb: number;
  impuestos_internos: number;
  otros_conceptos: number;
  total: number;
  es_venta: boolean;
  estado_validacion: string;
}

interface TaxPositionData {
  periodo: string;
  anio: number;
  mes: number;
  empresa: {
    cuit: string;
    razon_social: string;
  };
  debito_fiscal: number;
  credito_fiscal: number;
  credito_fiscal_desglose: {
    iva_21: number;
    iva_105: number;
    iva_27: number;
  };
  percepciones_iva: number;
  percepciones_iibb: number;
  impuestos_internos: number;
  otros_conceptos: number;
  saldo_tecnico: number;
  saldo_final: number;
  resultado: "SALDO_A_FAVOR" | "SALDO_A_PAGAR";
  total_comprobantes: number;
  comprobantes: ImputedVoucher[];
}

const MESES = [
  { value: 1, label: "01 - Enero" },
  { value: 2, label: "02 - Febrero" },
  { value: 3, label: "03 - Marzo" },
  { value: 4, label: "04 - Abril" },
  { value: 5, label: "05 - Mayo" },
  { value: 6, label: "06 - Junio" },
  { value: 7, label: "07 - Julio" },
  { value: 8, label: "08 - Agosto" },
  { value: 9, label: "09 - Septiembre" },
  { value: 10, label: "10 - Octubre" },
  { value: 11, label: "11 - Noviembre" },
  { value: 12, label: "12 - Diciembre" },
];

const ANIOS = [2026, 2025, 2024];

export const IvaLiquidationView: React.FC = () => {
  const { token, company } = useAuth();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const today = new Date();
  const [selectedMonth, setSelectedMonth] = useState<number>(today.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(today.getFullYear());

  const [posicion, setPosicion] = useState<TaxPositionData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Consulta de Posición Impositiva desde el Backend
  const fetchPosicionIva = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const headers = getAuthHeaders({ "Content-Type": "application/json" });
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(
        `${apiUrl}/api/v1/liquidaciones/iva/posicion?anio=${selectedYear}&mes=${selectedMonth}`,
        { headers }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Error al calcular liquidación de IVA.");
      }

      const data: TaxPositionData = await res.json();
      setPosicion(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error de conexión al liquidar IVA.";
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  }, [apiUrl, selectedYear, selectedMonth, token]);

  useEffect(() => {
    fetchPosicionIva();
  }, [fetchPosicionIva]);

  // Descarga de archivos reglamentarios AFIP (.txt)
  const handleExportTxt = async (tipo: "compras" | "ventas") => {
    setIsExporting(true);
    try {
      const headers = getAuthHeaders();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(
        `${apiUrl}/api/v1/liquidaciones/iva/exportar/${tipo}?anio=${selectedYear}&mes=${selectedMonth}`,
        { headers }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Error al exportar archivo.");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `LIBRO_IVA_${tipo.toUpperCase()}_${selectedYear}_${String(selectedMonth).padStart(2, "0")}.txt`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error al descargar TXT reglamentario.");
    } finally {
      setIsExporting(false);
    }
  };

  const isSaldoAFavor = (posicion?.saldo_final ?? 0) <= 0;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 font-sans">
      {/* Encabezado y Selectores de Período Fiscal */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-slate-900">
              Liquidación Mensual de IVA
            </h1>
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
              Libro IVA Digital AFIP
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Cálculo algorítmico de Débito Fiscal, Crédito Fiscal, Percepciones y exportación reglamentaria RG 4597.
          </p>
        </div>

        {/* Selectores de Período y Botón Refrescar */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(parseInt(e.target.value, 10))}
              className="rounded-xl bg-transparent px-2.5 py-1 text-xs font-semibold text-slate-700 focus:outline-none"
            >
              {MESES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>

            <span className="text-slate-300">/</span>

            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
              className="rounded-xl bg-transparent px-2.5 py-1 text-xs font-semibold text-slate-700 focus:outline-none"
            >
              {ANIOS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={fetchPosicionIva}
            disabled={isLoading}
            title="Recalcular liquidación"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <Icons.Refresh className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Alerta de Error */}
      {errorMsg && (
        <div className="mb-6 flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800">
          <div className="flex items-center gap-2">
            <Icons.AlertCircle className="h-4 w-4 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="font-bold">
            ✕
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4 TARJETAS DE RESUMEN MÉTRICO                                            */}
      {/* ========================================================================= */}
      <div className="mb-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Tarjeta 1: Débito Fiscal */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">1. Débito Fiscal</span>
            <span className="text-xs font-semibold text-blue-600">Ventas</span>
          </div>
          <div className="font-mono text-2xl font-extrabold text-slate-900">
            $ {(posicion?.debito_fiscal ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">IVA liquidado en facturación emitida</p>
        </div>

        {/* Tarjeta 2: Crédito Fiscal */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">2. Crédito Fiscal</span>
            <span className="text-xs font-semibold text-emerald-600">Compras</span>
          </div>
          <div className="font-mono text-2xl font-extrabold text-slate-900">
            $ {(posicion?.credito_fiscal ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            21%: ${(posicion?.credito_fiscal_desglose.iva_21 ?? 0).toFixed(2)} • 10.5%: ${(posicion?.credito_fiscal_desglose.iva_105 ?? 0).toFixed(2)}
          </p>
        </div>

        {/* Tarjeta 3: Percepciones de IVA Computables */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">3. Percepciones IVA</span>
            <span className="text-xs font-semibold text-indigo-600">Pagos a Cta</span>
          </div>
          <div className="font-mono text-2xl font-extrabold text-slate-900">
            $ {(posicion?.percepciones_iva ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Percepciones aduaneras y de proveedores</p>
        </div>

        {/* Tarjeta 4: Posición Neta del Período */}
        <div
          className={`rounded-3xl border p-5 shadow-sm transition ${
            isSaldoAFavor
              ? "border-emerald-200 bg-emerald-50/70"
              : "border-blue-200 bg-blue-50/70"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
              4. Posición Neta
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                isSaldoAFavor
                  ? "bg-emerald-500 text-white"
                  : "bg-blue-600 text-white"
              }`}
            >
              {isSaldoAFavor ? "SALDO A FAVOR" : "A INGRESAR"}
            </span>
          </div>
          <div
            className={`font-mono text-2xl font-extrabold ${
              isSaldoAFavor ? "text-emerald-900" : "text-blue-900"
            }`}
          >
            $ {Math.abs(posicion?.saldo_final ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 font-medium">
            {isSaldoAFavor
              ? "Saldo de libre disponibilidad transferible al siguiente mes"
              : "Monto a ingresar en VEP AFIP Formulario 2002"}
          </p>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* BARRA DE ACCIÓN: EXPORTACIÓN LIBRO IVA DIGITAL (.TXT)                     */}
      {/* ========================================================================= */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Icons.Download className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-900">
              Archivos Reglamentarios AFIP / ARCA (RG 4597)
            </h4>
            <p className="text-xs text-slate-400">
              Texto plano con estructura de campos fijos para importación directa en el portal de Libro IVA Digital.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isExporting || (posicion?.total_comprobantes ?? 0) === 0}
            onClick={() => handleExportTxt("compras")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
          >
            <Icons.FileText className="h-3.5 w-3.5 text-slate-500" />
            <span>Descargar Compras (.TXT)</span>
          </button>

          <button
            type="button"
            disabled={isExporting || (posicion?.total_comprobantes ?? 0) === 0}
            onClick={() => handleExportTxt("ventas")}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
          >
            <Icons.Download className="h-3.5 w-3.5" />
            <span>Descargar Ventas (.TXT)</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TABLA DE COMPROBANTES IMPUTADOS EN EL PERÍODO                            */}
      {/* ========================================================================= */}
      <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Detalle de Comprobantes Imputados
            </h3>
            <p className="text-xs text-slate-400">
              {posicion?.total_comprobantes ?? 0} registros encontrados para el período fiscal {selectedMonth}/{selectedYear}.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="py-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="mt-3 text-xs text-slate-400">Consultando posición en base de datos...</p>
          </div>
        ) : (posicion?.comprobantes.length ?? 0) === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <Icons.FileText className="mx-auto h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm font-semibold text-slate-600">
              No hay comprobantes imputados en este período fiscal.
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Cambia el mes o año arriba para revisar otros períodos registrados.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50/60 font-semibold text-slate-600">
                <tr>
                  <th className="py-3 px-3">Fecha</th>
                  <th className="py-3 px-3">Tipo / Nro</th>
                  <th className="py-3 px-3">Razón Social</th>
                  <th className="py-3 px-3">CUIT</th>
                  <th className="py-3 px-3 text-right">Neto Gravado</th>
                  <th className="py-3 px-3 text-right">IVA Liquidado</th>
                  <th className="py-3 px-3 text-right">Percepciones</th>
                  <th className="py-3 px-3 text-right">Total</th>
                  <th className="py-3 px-3 text-center">Circuito</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {posicion?.comprobantes.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-3 text-slate-500 font-mono">
                      {c.fecha_imputacion_iva || c.fecha_emision}
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-900">
                      {c.tipo_comprobante} {String(c.punto_venta).padStart(4, "0")}-{String(c.numero_comprobante).padStart(8, "0")}
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-700 max-w-[200px] truncate">
                      {c.razon_social}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-500">
                      {c.cuit_emisor}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-slate-900">
                      ${Number(c.neto_gravado).toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700">
                      ${Number(c.iva_monto).toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-slate-600">
                      ${(Number(c.percepcion_iva) + Number(c.percepcion_iibb)).toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-extrabold text-slate-900">
                      {c.moneda === "USD" ? "u$s " : "$ "}{Number(c.total).toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          c.es_venta
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        }`}
                      >
                        {c.es_venta ? "Venta" : "Compra"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

