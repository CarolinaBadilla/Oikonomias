"use client";

import React, { useState, useRef, ChangeEvent, DragEvent } from "react";
import { Icons } from "./Icons";
import { getAuthHeaders } from "@/utils/api";

interface BankTransaction {
  fecha: string;
  descripcion: string;
  monto: number;
  tipo: "DEBITO" | "CREDITO";
  fila?: number;
}

interface InvoiceMatch {
  id: string;
  razon_social: string;
  cuit_emisor: string;
  cuit_receptor: string;
  tipo_comprobante: string;
  punto_venta: number;
  numero_comprobante: number;
  fecha_emision: string;
  total: number;
  estado_validacion: string;
}

interface ExactMatchItem {
  transaccion_banco: BankTransaction;
  comprobante: InvoiceMatch;
  tipo_coincidencia: "EXACTA";
  score: number;
  criterio: string;
}

interface FuzzyMatchItem {
  transaccion_banco: BankTransaction;
  comprobante: InvoiceMatch;
  tipo_coincidencia: "COINCIDENCIA DIFUSA";
  score: number;
  nombre_coincidente: string;
  criterio: string;
}

interface PendingItem extends BankTransaction {
  motivo: string;
  categoria_asignada?: string;
}

interface ReconciliationResult {
  resumen: {
    total_transacciones: number;
    total_exactas: number;
    total_difusas: number;
    total_pendientes: number;
    tasa_conciliacion_porcentaje: number;
  };
  coincidencias_exactas: ExactMatchItem[];
  coincidencias_difusas: FuzzyMatchItem[];
  partidas_pendientes: PendingItem[];
}

const CATEGORIAS_PENDIENTES = [
  "Comisión Bancaria / Mantenimiento",
  "Impuesto Débito/Crédito (Ley 25.413)",
  "Retención / Percepción Impositiva (AFIP/IIBB)",
  "Transferencia entre Cuentas Propias",
  "Pago de Sueldos y Cargas Sociales",
  "Servicios Básicos No Facturados",
  "Otros Gastos Operativos",
];

export const ReconciliationDashboard: React.FC = () => {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"exact" | "fuzzy" | "pending">("exact");
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);

  const [acceptedFuzzyIds, setAcceptedFuzzyIds] = useState<Set<string>>(new Set());
  const [categoriesMap, setCategoriesMap] = useState<Record<number, string>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (selectedFile: File) => {
    setErrorMsg(null);
    setSuccessMsg(null);

    const ext = selectedFile.name.split(".").pop()?.toLowerCase();
    if (!["csv", "xlsx", "xls"].includes(ext || "")) {
      setErrorMsg("Formato no soportado. Sube un archivo de extracto bancario en formato .csv, .xlsx o .xls.");
      return;
    }

    setFile(selectedFile);
    processReconciliation(selectedFile);
  };

  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const processReconciliation = async (fileToUpload: File) => {
    setIsProcessing(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setAcceptedFuzzyIds(new Set());
    setCategoriesMap({});

    const formData = new FormData();
    formData.append("file", fileToUpload);

    try {
      const response = await fetch(`${apiUrl}/api/v1/reconciliation/process`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.detail || `Error ${response.status}: No se pudo procesar el extracto bancario`);
      }

      const result: ReconciliationResult = await response.json();
      setReconciliation(result);
      setSuccessMsg(
        `Extracto procesado con éxito. Se analizaron ${result.resumen.total_transacciones} transacciones con una tasa de conciliación del ${result.resumen.tasa_conciliacion_porcentaje}%.`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al procesar la conciliación.";
      setErrorMsg(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAcceptFuzzy = (matchIndex: number) => {
    setAcceptedFuzzyIds((prev) => {
      const next = new Set(prev);
      next.add(String(matchIndex));
      return next;
    });
  };

  const handleAssignCategory = (rowIndex: number, category: string) => {
    setCategoriesMap((prev) => ({
      ...prev,
      [rowIndex]: category,
    }));
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Título y Descripción con Estética Clara */}
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">
            Conciliación Bancaria Algorítmica
          </h1>
          <p className="text-sm text-slate-500 mb-6">
            Cruce automatizado con Pandas y Fuzzy Matching (RapidFuzz) sobre facturas en PostgreSQL.
          </p>
        </div>

        {reconciliation && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <Icons.CloudUpload className="h-4 w-4 text-blue-600" />
              <span>Cargar Otro Extracto</span>
            </button>
          </div>
        )}
      </div>

      {/* Alertas */}
      {errorMsg && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 shadow-sm">
          <Icons.AlertCircle className="h-5 w-5 shrink-0 text-rose-600" />
          <div className="flex-1">
            <p className="font-semibold">Error en la conciliación</p>
            <p className="mt-0.5">{errorMsg}</p>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-rose-500 hover:text-rose-700">
            ✕
          </button>
        </div>
      )}

      {successMsg && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 shadow-sm">
          <Icons.CheckCircle className="h-5 w-5 shrink-0 text-emerald-600" />
          <div className="flex-1">
            <p className="font-semibold">{successMsg}</p>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700">
            ✕
          </button>
        </div>
      )}

      {/* Caja de Carga del Extracto Bancario: Estilo Pulcro y Claro */}
      {!reconciliation && (
        <div className="mb-10">
          <input
            type="file"
            ref={fileInputRef}
            onChange={onFileInputChange}
            accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
            className="hidden"
          />

          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed border-blue-200 bg-white rounded-2xl p-10 text-center hover:border-blue-400 transition-all shadow-sm cursor-pointer ${
              isDragging ? "border-blue-500 bg-blue-50/50" : ""
            }`}
          >
            {isProcessing ? (
              <div className="flex flex-col items-center justify-center py-6">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                <p className="mt-4 text-sm font-semibold text-slate-800">
                  Ejecutando algoritmo de conciliación...
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Normalizando extracto bancario con Pandas y cruzando facturas con RapidFuzz
                </p>
              </div>
            ) : (
              <>
                <div className="bg-blue-50 text-blue-600 p-4 rounded-full mx-auto w-fit mb-3 shadow-sm">
                  <Icons.CloudUpload className="h-8 w-8 stroke-[1.75]" />
                </div>
                <h3 className="text-lg font-bold text-slate-800">
                  Arrastrá aquí el extracto bancario (.CSV o .XLSX)
                </h3>
                <p className="text-sm text-slate-400 mt-1">
                  Compatible con Santander, Galicia, BBVA, Macro, Nación, Mercado Pago y extractos estándar
                </p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="mt-6 bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 rounded-xl shadow-sm transition"
                >
                  Seleccionar archivo desde el equipo
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Dashboard y Métricas tras procesar (Todo en fondo blanco limpio) */}
      {reconciliation && (
        <div className="space-y-6">
          <input
            type="file"
            ref={fileInputRef}
            onChange={onFileInputChange}
            accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
            className="hidden"
          />

          {/* Tarjetas de Resumen Métrico (Fondo Blanco) */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {/* Total Transacciones */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <span className="text-xs font-semibold text-slate-500">
                Total Transacciones
              </span>
              <p className="mt-2 font-mono text-2xl font-bold text-slate-900">
                {reconciliation.resumen.total_transacciones}
              </p>
              <div className="mt-1 text-[11px] text-slate-400">Filas analizadas</div>
            </div>

            {/* Exactas */}
            <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
              <span className="text-xs font-semibold text-emerald-800">
                Coincidencias Exactas
              </span>
              <p className="mt-2 font-mono text-2xl font-bold text-emerald-600">
                {reconciliation.resumen.total_exactas}
              </p>
              <div className="mt-1 text-[11px] text-emerald-600">
                100% Importe + CUIT/N°
              </div>
            </div>

            {/* Difusas */}
            <div className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
              <span className="text-xs font-semibold text-indigo-800">
                Coincidencias Difusas
              </span>
              <p className="mt-2 font-mono text-2xl font-bold text-indigo-600">
                {reconciliation.resumen.total_difusas}
              </p>
              <div className="mt-1 text-[11px] text-indigo-600">
                Score &ge; 70% con Razón Social
              </div>
            </div>

            {/* Pendientes */}
            <div className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
              <span className="text-xs font-semibold text-amber-800">
                Partidas Pendientes
              </span>
              <p className="mt-2 font-mono text-2xl font-bold text-amber-600">
                {reconciliation.resumen.total_pendientes}
              </p>
              <div className="mt-1 text-[11px] text-amber-600">
                Comisiones / Sin comprobante
              </div>
            </div>

            {/* Tasa de Conciliación */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <span className="text-xs font-semibold text-slate-500">
                Tasa de Conciliación
              </span>
              <p className="mt-2 font-mono text-2xl font-bold text-slate-900">
                {reconciliation.resumen.tasa_conciliacion_porcentaje}%
              </p>
              <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, reconciliation.resumen.tasa_conciliacion_porcentaje)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Navegación por Pestañas */}
          <div className="rounded-3xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
            <div className="flex border-b border-slate-100 px-6 pt-4 bg-slate-50/50">
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setActiveTab("exact")}
                  className={`flex items-center gap-2 border-b-2 px-3 pb-3 text-sm font-semibold transition ${
                    activeTab === "exact"
                      ? "border-emerald-500 text-emerald-600"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-700">
                    {reconciliation.coincidencias_exactas.length}
                  </span>
                  Coincidencias Exactas
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("fuzzy")}
                  className={`flex items-center gap-2 border-b-2 px-3 pb-3 text-sm font-semibold transition ${
                    activeTab === "fuzzy"
                      ? "border-indigo-500 text-indigo-600"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-bold text-indigo-700">
                    {reconciliation.coincidencias_difusas.length}
                  </span>
                  Coincidencias Difusas (Sugeridas)
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("pending")}
                  className={`flex items-center gap-2 border-b-2 px-3 pb-3 text-sm font-semibold transition ${
                    activeTab === "pending"
                      ? "border-amber-500 text-amber-600"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-700">
                    {reconciliation.partidas_pendientes.length}
                  </span>
                  Partidas Pendientes
                </button>
              </div>
            </div>

            {/* TAB 1: COINCIDENCIAS EXACTAS */}
            {activeTab === "exact" && (
              <div className="overflow-x-auto p-6 bg-white">
                {reconciliation.coincidencias_exactas.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">
                    No se encontraron coincidencias exactas con CUIT o número en la descripción.
                  </p>
                ) : (
                  <table className="w-full text-left text-sm text-slate-600">
                    <thead className="border-b border-slate-100 text-xs font-semibold uppercase text-slate-400">
                      <tr>
                        <th className="py-3 px-4">Fecha Banco</th>
                        <th className="py-3 px-4">Descripción Banco</th>
                        <th className="py-3 px-4 text-right">Monto</th>
                        <th className="py-3 px-4">Comprobante Emparejado</th>
                        <th className="py-3 px-4">Criterio</th>
                        <th className="py-3 px-4 text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reconciliation.coincidencias_exactas.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/70 transition">
                          <td className="py-3.5 px-4 font-mono text-xs text-slate-700">
                            {item.transaccion_banco.fecha}
                          </td>
                          <td className="py-3.5 px-4 font-medium text-slate-900">
                            {item.transaccion_banco.descripcion}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                            ${item.transaccion_banco.monto.toFixed(2)}
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-slate-900">
                              {item.comprobante.razon_social || "PROVEEDOR GENERAL"}
                            </div>
                            <div className="text-xs text-slate-400 font-mono">
                              {item.comprobante.tipo_comprobante} N° {item.comprobante.numero_comprobante} | CUIT: {item.comprobante.cuit_emisor}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-500">
                            {item.criterio}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                              <Icons.CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                              100% Exacta
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* TAB 2: COINCIDENCIAS DIFUSAS */}
            {activeTab === "fuzzy" && (
              <div className="overflow-x-auto p-6 bg-white">
                {reconciliation.coincidencias_difusas.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">
                    No hay sugerencias difusas pendientes de validación.
                  </p>
                ) : (
                  <table className="w-full text-left text-sm text-slate-600">
                    <thead className="border-b border-slate-100 text-xs font-semibold uppercase text-slate-400">
                      <tr>
                        <th className="py-3 px-4">Fecha Banco</th>
                        <th className="py-3 px-4">Descripción Banco</th>
                        <th className="py-3 px-4 text-right">Monto</th>
                        <th className="py-3 px-4">Razón Social Sugerida</th>
                        <th className="py-3 px-4 text-center">Score RapidFuzz</th>
                        <th className="py-3 px-4 text-center">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reconciliation.coincidencias_difusas.map((item, idx) => {
                        const isAccepted = acceptedFuzzyIds.has(String(idx));
                        return (
                          <tr key={idx} className="hover:bg-slate-50/70 transition">
                            <td className="py-3.5 px-4 font-mono text-xs text-slate-700">
                              {item.transaccion_banco.fecha}
                            </td>
                            <td className="py-3.5 px-4 font-medium text-slate-900">
                              {item.transaccion_banco.descripcion}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                              ${item.transaccion_banco.monto.toFixed(2)}
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-semibold text-slate-900">
                                {item.nombre_coincidente || item.comprobante.razon_social}
                              </div>
                              <div className="text-xs text-slate-400 font-mono">
                                {item.comprobante.tipo_comprobante} N° {item.comprobante.numero_comprobante} | Total: ${Number(item.comprobante.total).toFixed(2)}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">
                                {item.score}%
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              {isAccepted ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                                  ✓ Cruce Aceptado
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleAcceptFuzzy(idx)}
                                  className="inline-flex items-center gap-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 text-xs font-semibold shadow-sm transition"
                                >
                                  Aceptar Cruce
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* TAB 3: PARTIDAS PENDIENTES */}
            {activeTab === "pending" && (
              <div className="overflow-x-auto p-6 bg-white">
                {reconciliation.partidas_pendientes.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">
                    ¡Excelente! No hay partidas pendientes en este extracto bancario.
                  </p>
                ) : (
                  <table className="w-full text-left text-sm text-slate-600">
                    <thead className="border-b border-slate-100 text-xs font-semibold uppercase text-slate-400">
                      <tr>
                        <th className="py-3 px-4">Fecha</th>
                        <th className="py-3 px-4">Descripción del Movimiento</th>
                        <th className="py-3 px-4 text-right">Monto</th>
                        <th className="py-3 px-4 text-center">Tipo</th>
                        <th className="py-3 px-4">Categorización Contable</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reconciliation.partidas_pendientes.map((item, idx) => {
                        const currentCategory = categoriesMap[idx] || "";
                        return (
                          <tr key={idx} className="hover:bg-slate-50/70 transition">
                            <td className="py-3.5 px-4 font-mono text-xs text-slate-700">
                              {item.fecha}
                            </td>
                            <td className="py-3.5 px-4">
                              <span className="font-medium text-slate-900">
                                {item.descripcion}
                              </span>
                              <p className="mt-0.5 text-xs text-slate-400">
                                {item.motivo}
                              </p>
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                              ${item.monto.toFixed(2)}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <span
                                className={`rounded-md px-2 py-0.5 font-mono text-xs font-bold ${
                                  item.tipo === "DEBITO"
                                    ? "bg-rose-50 text-rose-700 border border-rose-100"
                                    : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                                }`}
                              >
                                {item.tipo}
                              </span>
                            </td>
                            <td className="py-3.5 px-4">
                              <select
                                value={currentCategory}
                                onChange={(e) => handleAssignCategory(idx, e.target.value)}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition focus:border-blue-500 focus:outline-none"
                              >
                                <option value="">-- Seleccionar Categoría --</option>
                                {CATEGORIAS_PENDIENTES.map((cat) => (
                                  <option key={cat} value={cat}>
                                    {cat}
                                  </option>
                                ))}
                              </select>
                              {currentCategory && (
                                <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                                  ✓ Categorizado
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
