"use client";

import React, { useState, useEffect, useRef, ChangeEvent, DragEvent, useMemo } from "react";
import { Icons } from "./Icons";
import { getAuthHeaders } from "@/utils/api";

export interface ProcessedInvoiceFile {
  id: string;
  name: string;
  size: string;
  uploadedAt: string;
  type: "PDF" | "JPG" | "PNG";
  status: "processing" | "processed" | "error";
  progress: number;
  invoiceData?: any;
  fileObj?: File;
  previewUrl?: string;
}

interface HomeUploadViewProps {
  onInvoiceProcessed?: (invoice: any) => void;
  onSelectInvoiceForAudit?: (fileItem: ProcessedInvoiceFile) => void;
}

type VoucherFilterType = "TODOS" | "FACTURA A" | "FACTURA B" | "FACTURA C" | "NC_ND";

const MESES = [
  { value: "ALL", label: "Todos los Meses" },
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

const ANIOS = [
  { value: "ALL", label: "Todos los Años" },
  { value: 2026, label: "2026" },
  { value: 2025, label: "2025" },
  { value: 2024, label: "2024" },
];

export const HomeUploadView: React.FC<HomeUploadViewProps> = ({
  onInvoiceProcessed,
  onSelectInvoiceForAudit,
}) => {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const [recentFiles, setRecentFiles] = useState<ProcessedInvoiceFile[]>([]);
  const [isLoadingPersisted, setIsLoadingPersisted] = useState<boolean>(true);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Estados de Filtros
  const [voucherFilter, setVoucherFilter] = useState<VoucherFilterType>("TODOS");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Período fiscal por defecto mes y año corrientes
  const today = new Date();
  const [selectedMonth, setSelectedMonth] = useState<number | "ALL">(today.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number | "ALL">(today.getFullYear());

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Carga persistente desde el Backend al montar el componente
  useEffect(() => {
    let isMounted = true;

    const fetchPersistedInvoices = async () => {
      try {
        setIsLoadingPersisted(true);
        const res = await fetch(`${apiUrl}/api/v1/invoices/`, {
          method: "GET",
          headers: getAuthHeaders({ "Content-Type": "application/json" }),
        });

        if (res.ok && isMounted) {
          const data = await res.json();
          if (Array.isArray(data)) {
            const mappedFiles: ProcessedInvoiceFile[] = data.map((inv: any) => ({
              id: inv.id,
              name: `${inv.tipo_comprobante} ${String(inv.punto_venta).padStart(4, "0")}-${String(inv.numero_comprobante).padStart(8, "0")}`,
              size: `${inv.moneda === "USD" ? "u$s" : "$"}${Number(inv.total).toFixed(2)}`,
              uploadedAt: inv.fecha_emision ? `Emisión: ${inv.fecha_emision}` : "Registrado en BD",
              type: "PDF",
              status: "processed",
              progress: 100,
              invoiceData: inv,
            }));
            setRecentFiles(mappedFiles);
          }
        }
      } catch (err) {
        console.warn("No se pudieron cargar comprobantes persistidos:", err);
      } finally {
        if (isMounted) {
          setIsLoadingPersisted(false);
        }
      }
    };

    fetchPersistedInvoices();

    return () => {
      isMounted = false;
    };
  }, [apiUrl]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSelectFile = (item: ProcessedInvoiceFile) => {
    onInvoiceProcessed?.(item.invoiceData || item);
    onSelectInvoiceForAudit?.(item);
  };

  const processUpload = async (file: File) => {
    setErrorMsg(null);
    const ext = file.name.split(".").pop()?.toUpperCase() || "PDF";
    const fileType: "PDF" | "JPG" | "PNG" = ext === "PDF" ? "PDF" : ext === "PNG" ? "PNG" : "JPG";

    const newId = `upload-${Date.now()}`;
    const previewUrl = URL.createObjectURL(file);

    const newFileItem: ProcessedInvoiceFile = {
      id: newId,
      name: file.name,
      size: formatFileSize(file.size),
      uploadedAt: "Subiendo y analizando...",
      type: fileType,
      status: "processing",
      progress: 35,
      fileObj: file,
      previewUrl,
    };

    setRecentFiles((prev) => [newFileItem, ...prev]);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const progressTimer = setInterval(() => {
        setRecentFiles((prev) =>
          prev.map((item) =>
            item.id === newId && item.progress < 85
              ? { ...item, progress: item.progress + 15 }
              : item
          )
        );
      }, 400);

      const response = await fetch(`${apiUrl}/api/v1/invoices/upload`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });

      clearInterval(progressTimer);

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.detail || `Error ${response.status} en la extracción.`);
      }

      const extractedData = await response.json();

      setRecentFiles((prev) =>
        prev.map((item) =>
          item.id === newId
            ? {
                ...item,
                status: "processed",
                progress: 100,
                name: `${extractedData.tipo_comprobante} ${String(extractedData.punto_venta).padStart(4, "0")}-${String(extractedData.numero_comprobante).padStart(8, "0")}`,
                size: `${extractedData.moneda === "USD" ? "u$s" : "$"}${Number(extractedData.total).toFixed(2)}`,
                uploadedAt: `Emisión: ${extractedData.fecha_emision}`,
                invoiceData: extractedData,
              }
            : item
        )
      );

      onInvoiceProcessed?.(extractedData);
      onSelectInvoiceForAudit?.({
        ...newFileItem,
        status: "processed",
        progress: 100,
        invoiceData: extractedData,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error durante el procesamiento.";
      setErrorMsg(message);
      setRecentFiles((prev) =>
        prev.map((item) =>
          item.id === newId
            ? { ...item, status: "error", uploadedAt: "Fallo en la extracción" }
            : item
        )
      );
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
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processUpload(e.target.files[0]);
    }
  };

  // =========================================================================
  // LÓGICA DE FILTRADO COMBINADO (TIPO + PERÍODO FISCAL + BÚSQUEDA TEXTO)
  // =========================================================================
  const periodAndSearchFiltered = useMemo(() => {
    return recentFiles.filter((item) => {
      const inv = item.invoiceData;

      // 1. Filtro Período Fiscal (Año y Mes)
      const fecha = inv?.fecha_imputacion_iva || inv?.fecha_emision;
      if (fecha && (selectedMonth !== "ALL" || selectedYear !== "ALL")) {
        const parts = fecha.split("-");
        if (parts.length >= 2) {
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10);
          if (selectedYear !== "ALL" && y !== selectedYear) return false;
          if (selectedMonth !== "ALL" && m !== selectedMonth) return false;
        }
      }

      // 2. Filtro de Búsqueda por Texto (Razón Social o CUIT)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const rs = (inv?.razon_social || "").toLowerCase();
        const cuitE = (inv?.cuit_emisor || "").toLowerCase();
        const cuitR = (inv?.cuit_receptor || "").toLowerCase();
        const name = (item.name || "").toLowerCase();
        if (!rs.includes(q) && !cuitE.includes(q) && !cuitR.includes(q) && !name.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [recentFiles, selectedMonth, selectedYear, searchQuery]);

  // Conteo dinámico para los badges
  const counts = useMemo(() => {
    return {
      TODOS: periodAndSearchFiltered.length,
      FACTURA_A: periodAndSearchFiltered.filter((item) => {
        const t = (item.invoiceData?.tipo_comprobante || item.name || "").toUpperCase();
        return t.includes("FACTURA A") || t.includes("FAC A") || (t.includes("FACTURA") && t.endsWith(" A"));
      }).length,
      FACTURA_B: periodAndSearchFiltered.filter((item) => {
        const t = (item.invoiceData?.tipo_comprobante || item.name || "").toUpperCase();
        return t.includes("FACTURA B") || t.includes("FAC B") || (t.includes("FACTURA") && t.endsWith(" B"));
      }).length,
      FACTURA_C: periodAndSearchFiltered.filter((item) => {
        const t = (item.invoiceData?.tipo_comprobante || item.name || "").toUpperCase();
        return t.includes("FACTURA C") || t.includes("FAC C") || (t.includes("FACTURA") && t.endsWith(" C"));
      }).length,
      NC_ND: periodAndSearchFiltered.filter((item) => {
        const t = (item.invoiceData?.tipo_comprobante || item.name || "").toUpperCase();
        return t.includes("NOTA") || t.includes("CRED") || t.includes("DEB");
      }).length,
    };
  }, [periodAndSearchFiltered]);

  // Lista final mostrada aplicando la pestaña de comprobante
  const displayFiles = useMemo(() => {
    return periodAndSearchFiltered.filter((item) => {
      const t = (item.invoiceData?.tipo_comprobante || item.name || "").toUpperCase();
      if (voucherFilter === "FACTURA A") {
        return t.includes("FACTURA A") || t.includes("FAC A") || (t.includes("FACTURA") && t.endsWith(" A"));
      }
      if (voucherFilter === "FACTURA B") {
        return t.includes("FACTURA B") || t.includes("FAC B") || (t.includes("FACTURA") && t.endsWith(" B"));
      }
      if (voucherFilter === "FACTURA C") {
        return t.includes("FACTURA C") || t.includes("FAC C") || (t.includes("FACTURA") && t.endsWith(" C"));
      }
      if (voucherFilter === "NC_ND") {
        return t.includes("NOTA") || t.includes("CRED") || t.includes("DEB");
      }
      return true;
    });
  }, [periodAndSearchFiltered, voucherFilter]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 font-sans">
      {/* Encabezado */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">
          Carga y Auditoría de Comprobantes
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Subí facturas, tickets y notas fiscales para extracción óptica con IA, validación matemática y persistencia contable.
        </p>
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

      {/* Zona Drag and Drop */}
      <div className="mb-10">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf, .jpg, .jpeg, .png, .webp"
          className="hidden"
          onChange={handleFileInputChange}
        />

        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex min-h-[260px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center transition-all duration-200 ${
            isDragging
              ? "border-blue-500 bg-blue-50/70 shadow-lg shadow-blue-500/10"
              : "border-blue-200/90 bg-white shadow-sm hover:border-blue-400 hover:bg-slate-50/50"
          }`}
        >
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-sm">
            <Icons.CloudUpload className="h-8 w-8 stroke-[1.75]" />
          </div>

          <h2 className="text-lg font-bold text-slate-900">
            Arrastrá y soltá aquí los comprobantes
          </h2>
          <p className="mt-1 text-xs text-slate-400 font-medium">
            Formatos soportados: PDF, JPG, PNG, WebP
          </p>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-blue-600 bg-white px-5 py-2 text-xs font-semibold text-blue-600 shadow-sm transition hover:bg-blue-600 hover:text-white"
          >
            <Icons.Folder className="h-4 w-4" />
            <span>Seleccionar archivos</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECCIÓN: COMPROBANTES REGISTRADOS CON FILTRADO RÁPIDO & PERÍODO FISCAL    */}
      {/* ========================================================================= */}
      <section className="space-y-4">
        {/* Cabecera de la Sección con Selectores de Período y Búsqueda */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              Bandeja de Comprobantes Registrados
            </h3>
            <p className="text-xs text-slate-400">
              Explorá, filtrá por alícuota o tipo fiscal y realizá auditoría detallada.
            </p>
          </div>

          {/* Selectores de Período y Búsqueda */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Buscador de Texto */}
            <div className="relative min-w-[220px]">
              <Icons.Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar Razón Social o CUIT..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3.5 py-1.5 text-xs text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Selector de Mes */}
            <select
              value={selectedMonth}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedMonth(val === "ALL" ? "ALL" : parseInt(val, 10));
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              {MESES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>

            {/* Selector de Año */}
            <select
              value={selectedYear}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedYear(val === "ALL" ? "ALL" : parseInt(val, 10));
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              {ANIOS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Barra Horizontal de Pestañas / Pills con Conteo Dinámico */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 pb-3 pt-1">
          {/* Pill Todos */}
          <button
            type="button"
            onClick={() => setVoucherFilter("TODOS")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
              voucherFilter === "TODOS"
                ? "bg-blue-600 text-white shadow-sm shadow-blue-600/20"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span>Todos</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                voucherFilter === "TODOS"
                  ? "bg-white/20 text-white"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {counts.TODOS}
            </span>
          </button>

          {/* Pill Facturas A */}
          <button
            type="button"
            onClick={() => setVoucherFilter("FACTURA A")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
              voucherFilter === "FACTURA A"
                ? "bg-blue-600 text-white shadow-sm shadow-blue-600/20"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span>Facturas A</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                voucherFilter === "FACTURA A"
                  ? "bg-white/20 text-white"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {counts.FACTURA_A}
            </span>
          </button>

          {/* Pill Facturas B */}
          <button
            type="button"
            onClick={() => setVoucherFilter("FACTURA B")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
              voucherFilter === "FACTURA B"
                ? "bg-blue-600 text-white shadow-sm shadow-blue-600/20"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span>Facturas B</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                voucherFilter === "FACTURA B"
                  ? "bg-white/20 text-white"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {counts.FACTURA_B}
            </span>
          </button>

          {/* Pill Facturas C */}
          <button
            type="button"
            onClick={() => setVoucherFilter("FACTURA C")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
              voucherFilter === "FACTURA C"
                ? "bg-blue-600 text-white shadow-sm shadow-blue-600/20"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span>Facturas C</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                voucherFilter === "FACTURA C"
                  ? "bg-white/20 text-white"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {counts.FACTURA_C}
            </span>
          </button>

          {/* Pill Notas de Débito / Crédito */}
          <button
            type="button"
            onClick={() => setVoucherFilter("NC_ND")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
              voucherFilter === "NC_ND"
                ? "bg-blue-600 text-white shadow-sm shadow-blue-600/20"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span>Notas de Débito / Crédito</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                voucherFilter === "NC_ND"
                  ? "bg-white/20 text-white"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {counts.NC_ND}
            </span>
          </button>
        </div>

        {/* Lista de Comprobantes Filtrados */}
        {isLoadingPersisted ? (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="mt-3 text-xs font-medium text-slate-500">Cargando comprobantes desde PostgreSQL...</p>
          </div>
        ) : displayFiles.length === 0 ? (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-12 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-400">
              <Icons.FileText className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-slate-700">
              No se encontraron comprobantes para los filtros seleccionados.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {recentFiles.length > 0
                ? "Prueba cambiando el mes, año o criterio de búsqueda."
                : "Arrastrá un archivo arriba para comenzar la extracción y auditoría fiscal."}
            </p>
            {(selectedMonth !== "ALL" || selectedYear !== "ALL" || searchQuery) && (
              <button
                type="button"
                onClick={() => {
                  setSelectedMonth("ALL");
                  setSelectedYear("ALL");
                  setSearchQuery("");
                  setVoucherFilter("TODOS");
                }}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:underline"
              >
                <span>Restablecer todos los filtros</span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {displayFiles.map((item) => {
              const estado = item.invoiceData?.estado_validacion;
              const isAsiento = estado === "ASIENTO REGISTRADO";
              const isValidado = estado === "VALIDADO";

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (item.status === "processed") {
                      handleSelectFile(item);
                    }
                  }}
                  className={`flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition ${
                    item.status === "processed"
                      ? "cursor-pointer hover:border-blue-300 hover:shadow-md"
                      : "cursor-wait opacity-90"
                  }`}
                >
                  {/* Info del Archivo */}
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl font-bold text-xs ${
                        item.type === "PDF"
                          ? "bg-rose-50 text-rose-600 border border-rose-100"
                          : "bg-blue-50 text-blue-600 border border-blue-100"
                      }`}
                    >
                      {item.type}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-slate-900 text-sm">
                          {item.name}
                        </span>
                        {item.invoiceData?.razon_social && (
                          <span className="hidden sm:inline-block rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 truncate max-w-[220px]">
                            {item.invoiceData.razon_social}
                          </span>
                        )}
                        {item.invoiceData?.moneda === "USD" && (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-200">
                            USD
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                        {item.invoiceData?.cuit_emisor && (
                          <>
                            <span className="font-mono">CUIT: {item.invoiceData.cuit_emisor}</span>
                            <span>•</span>
                          </>
                        )}
                        <span>{item.uploadedAt}</span>
                        <span>•</span>
                        <span className="font-bold text-slate-700">{item.size}</span>
                      </div>

                      {/* Barra de Progreso si está procesando */}
                      {item.status === "processing" && (
                        <div className="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full bg-blue-500 transition-all duration-300"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Estado & Acción */}
                  <div className="flex items-center gap-4 ml-4">
                    {item.status === "processed" ? (
                      isAsiento ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                          <Icons.CheckCircle className="h-3.5 w-3.5 text-emerald-700" />
                          Asiento Registrado
                        </span>
                      ) : isValidado ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          <Icons.CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                          Validado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                          En revisión
                        </span>
                      )
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                        {item.status === "error" ? "Error" : "Analizando..."}
                      </span>
                    )}

                    <div className="hidden sm:block text-slate-300 hover:text-slate-600">
                      <Icons.ChevronDown className="h-4 w-4 -rotate-90" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
