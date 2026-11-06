"use client";

import React, { useState, useRef, useEffect, ChangeEvent } from "react";
import { Icons } from "./Icons";
import { ProcessedInvoiceFile } from "./HomeUploadView";
import { getAuthHeaders } from "@/utils/api";

export interface InvoiceData {
  id?: string;
  razon_social: string;
  cuit_emisor: string;
  cuit_receptor: string;
  tipo_comprobante: string;
  punto_venta: number;
  numero_comprobante: number;

  // Fechas fiscales
  fecha_emision: string;
  fecha_imputacion_iva?: string;

  // Localización y Moneda
  provincia_facturacion?: string;
  moneda: "ARS" | "USD" | string;
  tipo_cambio: number;

  // Importes base
  neto_gravado: number;
  iva_monto: number;

  // Otros Tributos y Percepciones
  percepcion_iva: number;
  percepcion_iibb: number;
  iibb_jurisdiccion?: string;
  impuestos_internos: number;
  otros_conceptos: number;

  // Total y estado
  total: number;
  estado_validacion: string;
  created_at?: string;

  // AFIP CAE y Vencimiento
  cae?: string;
  fecha_vto_cae?: string;
}

interface SplitScreenAuditorProps {
  invoiceData?: any;
  selectedItem?: ProcessedInvoiceFile | null;
  onBack?: () => void;
}

const DEFAULT_INVOICE: InvoiceData = {
  razon_social: "QUIMISUR S.R.L.",
  cuit_emisor: "30712345678",
  cuit_receptor: "30987654321",
  tipo_comprobante: "FACTURA A",
  punto_venta: 1,
  numero_comprobante: 1234,
  fecha_emision: new Date().toISOString().split("T")[0],
  fecha_imputacion_iva: new Date().toISOString().split("T")[0],
  provincia_facturacion: "Neuquén",
  moneda: "ARS",
  tipo_cambio: 1.0,
  neto_gravado: 1000.0,
  iva_monto: 210.0,
  percepcion_iva: 0.0,
  percepcion_iibb: 0.0,
  iibb_jurisdiccion: "Neuquén",
  impuestos_internos: 0.0,
  otros_conceptos: 0.0,
  total: 1210.0,
  estado_validacion: "VALIDADO",
};

const PROVINCIAS_ARGENTINAS = [
  "Buenos Aires",
  "CABA",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Córdoba",
  "Corrientes",
  "Entre Ríos",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquén",
  "Río Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucumán",
];

export const SplitScreenAuditor: React.FC<SplitScreenAuditorProps> = ({
  invoiceData,
  selectedItem,
  onBack,
}) => {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const initialData =
    invoiceData?.invoiceData || invoiceData || selectedItem?.invoiceData || DEFAULT_INVOICE;

  const [invoice, setInvoice] = useState<InvoiceData>({
    ...DEFAULT_INVOICE,
    ...initialData,
    fecha_imputacion_iva: initialData?.fecha_imputacion_iva || initialData?.fecha_emision || DEFAULT_INVOICE.fecha_emision,
    moneda: initialData?.moneda || "ARS",
    tipo_cambio: Number(initialData?.tipo_cambio || 1.0),
    percepcion_iva: Number(initialData?.percepcion_iva || 0.0),
    percepcion_iibb: Number(initialData?.percepcion_iibb || 0.0),
    iibb_jurisdiccion: initialData?.iibb_jurisdiccion || initialData?.provincia_facturacion || "Neuquén",
    impuestos_internos: Number(initialData?.impuestos_internos || 0.0),
    otros_conceptos: Number(initialData?.otros_conceptos || 0.0),
  });

  const [fileName, setFileName] = useState<string>(
    invoiceData?.name || selectedItem?.name || "Comprobante_Fiscal.pdf"
  );
  const [fileSize, setFileSize] = useState<string>(
    invoiceData?.size || selectedItem?.size || "Archivo cargado"
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    invoiceData?.previewUrl || selectedItem?.previewUrl || null
  );
  const [isPdf, setIsPdf] = useState<boolean>(
    invoiceData?.type === "PDF" || selectedItem?.type === "PDF" || true
  );

  // Controles de visor
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [copiedCuit, setCopiedCuit] = useState<boolean>(false);

  // Estados de API y Validación AFIP
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isValidatingAfip, setIsValidatingAfip] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [afipStatusDetails, setAfipStatusDetails] = useState<{
    validado?: boolean;
    resultado?: string;
    mensaje?: string;
    cae?: string;
    fch_vto?: string;
    errores?: Array<{ code: number; msg: string } | string>;
    observaciones?: Array<{ code: number; msg: string } | string>;
    mostrarPopover?: boolean;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raw = invoiceData || selectedItem;
    if (raw) {
      const data = raw.invoiceData || raw;
      if (data && (data.cuit_emisor || data.total)) {
        setInvoice((prev) => ({
          ...prev,
          ...data,
          fecha_imputacion_iva: data.fecha_imputacion_iva || data.fecha_emision || prev.fecha_emision,
          moneda: data.moneda || prev.moneda || "ARS",
          tipo_cambio: Number(data.tipo_cambio || prev.tipo_cambio || 1.0),
          percepcion_iva: Number(data.percepcion_iva ?? prev.percepcion_iva ?? 0),
          percepcion_iibb: Number(data.percepcion_iibb ?? prev.percepcion_iibb ?? 0),
          iibb_jurisdiccion: data.iibb_jurisdiccion || prev.iibb_jurisdiccion || "Neuquén",
          impuestos_internos: Number(data.impuestos_internos ?? prev.impuestos_internos ?? 0),
          otros_conceptos: Number(data.otros_conceptos ?? prev.otros_conceptos ?? 0),
          cae: data.cae || prev.cae,
          fecha_vto_cae: data.fecha_vto_cae || prev.fecha_vto_cae,
        }));
      }
      if (raw.name) {
        setFileName(raw.name);
      }
      if (raw.size) {
        setFileSize(raw.size);
      }
      if (raw.previewUrl) {
        setPreviewUrl(raw.previewUrl);
      }
      if (raw.type) {
        setIsPdf(raw.type === "PDF");
      }
    }
  }, [invoiceData, selectedItem]);

  // Validación matemática avanzada:
  // Total == round(Neto_Gravado + IVA_Total + Conceptos_No_Gravados + Operaciones_Exentas + Percepcion_IVA + Percepcion_IIBB + Impuestos_Internos + Otros_Conceptos, 2)
  const otrosTributosTotal =
    Number(invoice.percepcion_iva || 0) +
    Number(invoice.percepcion_iibb || 0) +
    Number(invoice.impuestos_internos || 0) +
    Number(invoice.otros_conceptos || 0);

  const sumaCalculada =
    Number(invoice.neto_gravado || 0) +
    Number(invoice.iva_monto || 0) +
    otrosTributosTotal;

  const mathDiff = Math.abs(sumaCalculada - Number(invoice.total || 0));
  // Tolerancia de redondeo de 0.10 para contemplar diferencias de alícuotas AFIP / SAP
  const isMathValid = mathDiff <= 0.10;

  const getNumericInputValue = (val: any): number | string => {
    if (val === undefined || val === null || val === "") return "";
    if (typeof val === "number") return isNaN(val) ? "" : val;
    const cleaned = String(val).replace(/[^\d.-]/g, "");
    if (cleaned === "" || isNaN(Number(cleaned))) return "";
    return Number(cleaned);
  };

  const handleFieldChange = (field: keyof InvoiceData, value: string | number) => {
    const updated = {
      ...invoice,
      [field]: value,
    };

    // Si cambian importes, recalcular consistencia
    const taxFields = [
      "neto_gravado",
      "iva_monto",
      "percepcion_iva",
      "percepcion_iibb",
      "impuestos_internos",
      "otros_conceptos",
      "total",
    ];

    if (taxFields.includes(field)) {
      const getVal = (f: keyof InvoiceData) => (f === field ? Number(value) : Number(updated[f] || 0));
      const newNeto = getVal("neto_gravado");
      const newIva = getVal("iva_monto");
      const newPIva = getVal("percepcion_iva");
      const newPIibb = getVal("percepcion_iibb");
      const newImpInt = getVal("impuestos_internos");
      const newOtros = getVal("otros_conceptos");
      const newTotal = getVal("total");

      const sum = newNeto + newIva + newPIva + newPIibb + newImpInt + newOtros;
      updated.estado_validacion = Math.abs(sum - newTotal) <= 0.10 ? "VALIDADO" : "REVISION";
    }

    setInvoice(updated);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCuit(true);
    setTimeout(() => setCopiedCuit(false), 2000);
  };

  const handleApproveAndRegister = async () => {
    setIsSaving(true);
    setNotification(null);

    try {
      const payload = {
        razon_social: invoice.razon_social,
        cuit_emisor: invoice.cuit_emisor,
        cuit_receptor: invoice.cuit_receptor,
        tipo_comprobante: invoice.tipo_comprobante,
        punto_venta: Number(invoice.punto_venta),
        numero_comprobante: Number(invoice.numero_comprobante),
        fecha_emision: invoice.fecha_emision,
        fecha_imputacion_iva: invoice.fecha_imputacion_iva || invoice.fecha_emision,
        provincia_facturacion: invoice.provincia_facturacion || null,
        moneda: invoice.moneda,
        tipo_cambio: Number(invoice.tipo_cambio || 1.0),
        neto_gravado: Number(invoice.neto_gravado || 0),
        iva_monto: Number(invoice.iva_monto || 0),
        percepcion_iva: Number(invoice.percepcion_iva || 0),
        percepcion_iibb: Number(invoice.percepcion_iibb || 0),
        iibb_jurisdiccion: invoice.iibb_jurisdiccion || null,
        impuestos_internos: Number(invoice.impuestos_internos || 0),
        otros_conceptos: Number(invoice.otros_conceptos || 0),
        total: Number(invoice.total || 0),
      };

      let saved: InvoiceData;
      const isPersistedUUID =
        Boolean(invoice.id) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoice.id!);

      if (isPersistedUUID) {
        const patchRes = await fetch(`${apiUrl}/api/v1/invoices/${invoice.id}/approve`, {
          method: "PATCH",
          headers: getAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(payload),
        });

        if (patchRes.ok) {
          saved = await patchRes.json();
        } else {
          // Fallback a crear comprobante si el ID no reside en PostgreSQL
          const createRes = await fetch(`${apiUrl}/api/v1/invoices/`, {
            method: "POST",
            headers: getAuthHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ ...payload, estado_validacion: "ASIENTO REGISTRADO" }),
          });
          if (!createRes.ok) {
            const errorData = await createRes.json().catch(() => ({}));
            throw new Error(errorData.detail || "Error al registrar asiento contable.");
          }
          saved = await createRes.json();
        }
      } else {
        const createRes = await fetch(`${apiUrl}/api/v1/invoices/`, {
          method: "POST",
          headers: getAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ ...payload, estado_validacion: "ASIENTO REGISTRADO" }),
        });
        if (!createRes.ok) {
          const errorData = await createRes.json().catch(() => ({}));
          throw new Error(errorData.detail || "Error al registrar asiento contable.");
        }
        saved = await createRes.json();
      }

      setInvoice(saved);
      setIsEditing(false);
      setNotification({
        type: "success",
        text: "✓ Asiento contable registrado con éxito en el libro diario",
      });

      // Navegar de regreso tras confirmación visual
      setTimeout(() => {
        if (onBack) {
          onBack();
        }
      }, 1400);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al registrar el asiento.";
      setNotification({ type: "error", text: msg });
    } finally {
      setIsSaving(false);
    }
  };

  const handleVerifyAfip = async () => {
    setIsValidatingAfip(true);
    setNotification(null);

    try {
      let invoiceId = invoice.id;
      const isPersistedUUID =
        Boolean(invoiceId) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId!);

      // Si la factura no cuenta con UUID persistido en PostgreSQL, se crea primero
      if (!isPersistedUUID) {
        const payload = {
          razon_social: invoice.razon_social,
          cuit_emisor: invoice.cuit_emisor,
          cuit_receptor: invoice.cuit_receptor,
          tipo_comprobante: invoice.tipo_comprobante,
          punto_venta: Number(invoice.punto_venta),
          numero_comprobante: Number(invoice.numero_comprobante),
          fecha_emision: invoice.fecha_emision,
          fecha_imputacion_iva: invoice.fecha_imputacion_iva || invoice.fecha_emision,
          provincia_facturacion: invoice.provincia_facturacion || null,
          moneda: invoice.moneda,
          tipo_cambio: Number(invoice.tipo_cambio || 1.0),
          neto_gravado: Number(invoice.neto_gravado || 0),
          iva_monto: Number(invoice.iva_monto || 0),
          percepcion_iva: Number(invoice.percepcion_iva || 0),
          percepcion_iibb: Number(invoice.percepcion_iibb || 0),
          iibb_jurisdiccion: invoice.iibb_jurisdiccion || null,
          impuestos_internos: Number(invoice.impuestos_internos || 0),
          otros_conceptos: Number(invoice.otros_conceptos || 0),
          total: Number(invoice.total || 0),
          cae: invoice.cae || null,
          fecha_vto_cae: invoice.fecha_vto_cae || null,
        };

        const createRes = await fetch(`${apiUrl}/api/v1/invoices/`, {
          method: "POST",
          headers: getAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(payload),
        });

        if (!createRes.ok) {
          throw new Error("No se pudo persistir el comprobante para habilitar la consulta en AFIP.");
        }
        const createdData = await createRes.json();
        invoiceId = createdData.id;
        setInvoice((prev) => ({ ...prev, id: createdData.id }));
      }

      // Llamar al endpoint oficial de validación fiscal ante WSFE
      const verifyRes = await fetch(`${apiUrl}/api/v1/invoices/${invoiceId}/verify-afip`, {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
      });

      const data = await verifyRes.json();

      if (!verifyRes.ok) {
        throw new Error(data.detail || data.mensaje || "Error al consultar con el servicio WSFE de AFIP.");
      }

      if (data.validado === true) {
        const afipCae = data.afip_data?.cae || data.invoice?.cae || invoice.cae;
        const afipVto = data.afip_data?.fch_vto || data.invoice?.fecha_vto_cae || invoice.fecha_vto_cae;

        setInvoice((prev) => ({
          ...prev,
          estado_validacion: "VALIDADO AFIP",
          cae: afipCae,
          fecha_vto_cae: afipVto,
        }));

        setAfipStatusDetails({
          validado: true,
          resultado: data.afip_data?.resultado || "A",
          mensaje: data.mensaje || "Comprobante verificado con éxito ante los registros de AFIP / ARCA.",
          cae: afipCae,
          fch_vto: afipVto,
          observaciones: data.afip_data?.observaciones || [],
          mostrarPopover: false,
        });

        setNotification({
          type: "success",
          text: `✓ Comprobante validado con AFIP/ARCA (CAE: ${afipCae || "N/A"})`,
        });
      } else {
        const afipRes = data.detalles_discrepancia?.resultado_afip || "ERROR";
        const esNoEncontrado = afipRes === "NO_ENCONTRADO";
        const estadoNuevo = esNoEncontrado ? "NO REGISTRADO EN AFIP" : "DISCREPANCIA AFIP";

        setInvoice((prev) => ({
          ...prev,
          estado_validacion: estadoNuevo,
        }));

        setAfipStatusDetails({
          validado: false,
          resultado: afipRes,
          mensaje: data.mensaje,
          cae: data.detalles_discrepancia?.cae_afip,
          errores: data.detalles_discrepancia?.errores_afip || [],
          observaciones: data.detalles_discrepancia?.observaciones_afip || [],
          mostrarPopover: true,
        });

        setNotification({
          type: "error",
          text: data.mensaje || "AFIP informó observaciones o discrepancias en el comprobante.",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error inesperado al conectar con AFIP.";
      setNotification({ type: "error", text: msg });
    } finally {
      setIsValidatingAfip(false);
    }
  };

  const handleUploadNewFile = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const newFile = e.target.files[0];
      setFileName(newFile.name);
      setFileSize(`${(newFile.size / (1024 * 1024)).toFixed(1)} MB`);
      setIsPdf(newFile.type === "application/pdf" || newFile.name.endsWith(".pdf"));
      const url = URL.createObjectURL(newFile);
      setPreviewUrl(url);
    }
  };

  const currencySymbol = invoice.moneda === "USD" ? "u$s" : "$";
  const currencyPadding = invoice.moneda === "USD" ? "pl-14" : "pl-9";
  const totalEnPesosARS =
    invoice.moneda === "USD"
      ? Number(invoice.total || 0) * Number(invoice.tipo_cambio || 1.0)
      : Number(invoice.total || 0);

  return (
    <div className="flex flex-col min-h-full font-sans">
      {/* ========================================================= */}
      {/* CABECERA SUPERIOR DE AUDITORÍA                           */}
      {/* ========================================================= */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-200/80 bg-white px-6 py-3.5">
        <div className="flex items-center gap-4">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              title="Volver a Inicio"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <Icons.ArrowLeft className="h-4 w-4" />
            </button>
          )}

          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-bold text-slate-900">
                {invoice.tipo_comprobante} {String(invoice.punto_venta).padStart(4, "0")}-{String(invoice.numero_comprobante).padStart(8, "0")}
              </h1>

              {/* Badges de Estado de Validación */}
              {invoice.estado_validacion === "VALIDADO AFIP" ? (
                <div className="relative inline-block group">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 border border-emerald-300 shadow-xs">
                    <Icons.ShieldCheck className="h-4 w-4 text-emerald-600" />
                    <span>VALIDADO AFIP</span>
                    {invoice.cae && (
                      <span className="font-mono text-[11px] font-semibold text-emerald-900 border-l border-emerald-200 pl-1.5 ml-0.5">
                        CAE: {invoice.cae}
                      </span>
                    )}
                  </span>
                  {invoice.fecha_vto_cae && (
                    <div className="hidden group-hover:block absolute left-0 top-full mt-1.5 z-40 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] text-white shadow-xl font-mono">
                      Vencimiento CAE: {invoice.fecha_vto_cae}
                    </div>
                  )}
                </div>
              ) : invoice.estado_validacion === "DISCREPANCIA AFIP" || invoice.estado_validacion === "NO REGISTRADO EN AFIP" ? (
                <div className="relative inline-block group">
                  <button
                    type="button"
                    onClick={() => setAfipStatusDetails((prev) => prev ? { ...prev, mostrarPopover: !prev.mostrarPopover } : null)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border shadow-xs cursor-pointer ${
                      invoice.estado_validacion === "NO REGISTRADO EN AFIP"
                        ? "bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100"
                        : "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
                    }`}
                  >
                    <Icons.AlertCircle className="h-3.5 w-3.5" />
                    <span>{invoice.estado_validacion}</span>
                    <span className="text-[10px] underline ml-0.5 font-normal">ver motivo</span>
                  </button>

                  {/* Popover explicativo al hacer hover o clic */}
                  {afipStatusDetails && (
                    <div className="hidden group-hover:block absolute left-0 top-full mt-2 z-50 w-80 rounded-2xl bg-slate-900 p-4 text-white shadow-2xl text-xs space-y-2 border border-slate-800 animate-in fade-in">
                      <div className="font-bold flex items-center justify-between border-b border-slate-800 pb-1.5">
                        <span className="flex items-center gap-1.5 text-amber-400">
                          <Icons.AlertCircle className="h-3.5 w-3.5" />
                          Dictamen AFIP / ARCA
                        </span>
                        <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded font-mono text-slate-300">
                          {afipStatusDetails.resultado || "DISCREPANCIA"}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        {afipStatusDetails.mensaje}
                      </p>
                      {afipStatusDetails.errores && afipStatusDetails.errores.length > 0 && (
                        <div className="pt-2 border-t border-slate-800 space-y-1 text-[11px]">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Detalle de Errores:</span>
                          {afipStatusDetails.errores.map((err, idx) => (
                            <div key={idx} className="text-rose-300 font-mono text-[10.5px]">
                              • {typeof err === "object" ? `(${err.code}) ${err.msg}` : String(err)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : invoice.estado_validacion === "ASIENTO REGISTRADO" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                  <span>✓</span>
                  <span>Asiento Registrado</span>
                </span>
              ) : isMathValid ? (
                <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
                  Validado
                </span>
              ) : (
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200">
                  En revisión
                </span>
              )}

              {/* Tag de Moneda */}
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${invoice.moneda === "USD" ? "bg-indigo-50 text-indigo-700 border border-indigo-200" : "bg-slate-100 text-slate-600"}`}>
                {invoice.moneda} {invoice.moneda === "USD" && `(TC: $${Number(invoice.tipo_cambio).toFixed(2)})`}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              {fileName} • {fileSize} {invoice.provincia_facturacion && `• Jurisdicción: ${invoice.provincia_facturacion}`}
            </p>
          </div>
        </div>

        {/* Controles del Visor de Documento & Acciones Rápidas */}
        <div className="flex items-center gap-2.5">
          {/* Botón Acción Validar con AFIP */}
          <button
            type="button"
            disabled={isValidatingAfip}
            onClick={handleVerifyAfip}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-1.5 text-xs font-bold text-emerald-800 shadow-xs hover:bg-emerald-100 transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            title="Contrastar comprobante ante el WSFE oficial de AFIP / ARCA"
          >
            {isValidatingAfip ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-700 border-t-transparent" />
                <span>Validando...</span>
              </>
            ) : (
              <>
                <Icons.ShieldCheck className="h-4 w-4 text-emerald-600" />
                <span>Validar con AFIP</span>
              </>
            )}
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleUploadNewFile}
            accept=".pdf, .jpg, .jpeg, .png, .webp"
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <Icons.CloudUpload className="h-3.5 w-3.5" />
            <span>Reemplazar</span>
          </button>

          {/* Zoom [-] 100% [+] */}
          <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              title="Reducir zoom"
              onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.15))}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-600 hover:bg-white hover:text-slate-900 font-bold"
            >
              -
            </button>
            <span className="w-14 text-center text-xs font-mono font-semibold text-slate-700">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              type="button"
              title="Aumentar zoom"
              onClick={() => setZoomLevel((z) => Math.min(2.5, z + 0.15))}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-600 hover:bg-white hover:text-slate-900 font-bold"
            >
              +
            </button>
          </div>

          <button
            type="button"
            title="Pantalla completa"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          >
            <Icons.Maximize className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Alerta / Notificación de Guardado */}
      {notification && (
        <div className="px-6 pt-4">
          <div
            className={`flex items-center justify-between rounded-2xl p-4 text-xs font-medium ${
              notification.type === "success"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            <span>{notification.text}</span>
            <button onClick={() => setNotification(null)} className="font-bold">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* CUERPO: DISTRIBUCIÓN EN 2 COLUMNAS (50% / 50%)            */}
      {/* ========================================================= */}
      <div className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* ========================================== */}
        {/* COLUMNA IZQUIERDA: Visor de Documento      */}
        {/* ========================================== */}
        <div
          ref={viewerRef}
          className="flex flex-col rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm min-h-[680px] sticky top-20"
        >
          <div className="flex flex-1 items-center justify-center overflow-auto rounded-2xl bg-slate-100/70 p-4 border border-slate-100">
            {previewUrl ? (
              isPdf ? (
                <iframe
                  src={previewUrl}
                  title="Documento PDF"
                  className="h-full min-h-[620px] w-full rounded-xl border-0 bg-white shadow-sm"
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={previewUrl}
                  alt="Comprobante"
                  style={{
                    transform: `scale(${zoomLevel})`,
                    transition: "transform 0.1s ease-out",
                  }}
                  className="max-h-[620px] max-w-full rounded-lg object-contain shadow-md"
                />
              )
            ) : (
              /* Representación de Factura Renderizada tipo Escáner Fiscal AFIP */
              <div
                style={{
                  transform: `scale(${zoomLevel})`,
                  transition: "transform 0.1s ease-out",
                }}
                className="w-full max-w-md rounded-xl bg-white p-8 shadow-xl border border-slate-200 font-mono text-xs text-slate-800 space-y-4"
              >
                <div className="flex items-start justify-between border-b pb-4">
                  <div>
                    <h3 className="font-bold text-base text-slate-900">{invoice.razon_social}</h3>
                    <p className="text-[11px] text-slate-500">CUIT: {invoice.cuit_emisor}</p>
                    <p className="text-[11px] text-slate-500">
                      Jurisdicción: {invoice.provincia_facturacion || "Buenos Aires"} • IVA Resp. Inscripto
                    </p>
                  </div>
                  <div className="rounded-lg border-2 border-slate-900 px-3 py-1 text-center font-bold">
                    <span className="text-xl block">A</span>
                    <span className="text-[9px]">COD. 01</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] border-b pb-3">
                  <div>
                    <span className="text-slate-400 block">PUNTO DE VTA:</span>
                    <strong>{String(invoice.punto_venta).padStart(4, "0")}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">COMPROBANTE N°:</span>
                    <strong>{String(invoice.numero_comprobante).padStart(8, "0")}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">FECHA EMISIÓN:</span>
                    <strong>{invoice.fecha_emision}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">PERÍODO IVA:</span>
                    <strong>{invoice.fecha_imputacion_iva || invoice.fecha_emision}</strong>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400 block">CUIT CLIENTE:</span>
                    <strong>{invoice.cuit_receptor}</strong>
                  </div>
                </div>

                <div className="py-2 border-b">
                  <div className="flex justify-between font-semibold">
                    <span>CONCEPTO BIENES / SERVICIOS</span>
                    <span>{currencySymbol}{Number(invoice.neto_gravado).toFixed(2)}</span>
                  </div>
                </div>

                <div className="space-y-1.5 pt-2 text-[11px]">
                  <div className="flex justify-between text-slate-600">
                    <span>Importe Neto Gravado:</span>
                    <span>{currencySymbol}{Number(invoice.neto_gravado).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>IVA Liquidado (21%):</span>
                    <span>{currencySymbol}{Number(invoice.iva_monto).toFixed(2)}</span>
                  </div>
                  {Number(invoice.percepcion_iva || 0) > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>Percepción IVA:</span>
                      <span>{currencySymbol}{Number(invoice.percepcion_iva).toFixed(2)}</span>
                    </div>
                  )}
                  {Number(invoice.percepcion_iibb || 0) > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>Percepción IIBB ({invoice.iibb_jurisdiccion || "Neuquén"}):</span>
                      <span>{currencySymbol}{Number(invoice.percepcion_iibb).toFixed(2)}</span>
                    </div>
                  )}
                  {Number(invoice.impuestos_internos || 0) > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>Impuestos Internos:</span>
                      <span>{currencySymbol}{Number(invoice.impuestos_internos).toFixed(2)}</span>
                    </div>
                  )}
                  {Number(invoice.otros_conceptos || 0) > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>Otras Tasas / No Gravado:</span>
                      <span>{currencySymbol}{Number(invoice.otros_conceptos).toFixed(2)}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-base font-bold text-slate-900 border-t pt-2">
                    <span>TOTAL ({invoice.moneda}):</span>
                    <span>{currencySymbol}{Number(invoice.total).toFixed(2)}</span>
                  </div>

                  {invoice.moneda === "USD" && (
                    <div className="flex justify-between text-xs font-bold text-indigo-700 bg-indigo-50/70 p-2 rounded-lg mt-2">
                      <span>Equiv. Total ARS (TC: ${Number(invoice.tipo_cambio).toFixed(2)}):</span>
                      <span>${totalEnPesosARS.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t text-center text-[10px] text-slate-400">
                  CAE N° 74839201948572 • Vto. CAE: 14/11/2026
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ========================================== */}
        {/* COLUMNA DERECHA: 3 Tarjetas y Validación   */}
        {/* ========================================== */}
        <div className="flex flex-col justify-between rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm min-h-[680px]">
          <div className="space-y-6">
            {/* Banner Superior de Validación Matemática */}
            {isMathValid ? (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-emerald-800 shadow-sm">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500 text-white shrink-0">
                  <Icons.CheckCircle className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold">Validación Matemática Correcta</h4>
                  <p className="text-xs text-emerald-700">
                    Neto ({currencySymbol}{Number(invoice.neto_gravado || 0).toFixed(2)}) + IVA ({currencySymbol}{Number(invoice.iva_monto || 0).toFixed(2)}) + Otros Tributos ({currencySymbol}{otrosTributosTotal.toFixed(2)}) = Total ({currencySymbol}{Number(invoice.total || 0).toFixed(2)})
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-sm">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500 text-white shrink-0">
                  <Icons.AlertCircle className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold">Discrepancia Impositiva Detectada</h4>
                  <p className="text-xs text-amber-800">
                    Existe una diferencia de ${mathDiff.toFixed(2)} entre la suma calculada ({currencySymbol}{sumaCalculada.toFixed(2)}) y el total declarado ({currencySymbol}{Number(invoice.total || 0).toFixed(2)}). Tolerancia de alícuotas AFIP/ARCA: ±0.10.
                  </p>
                </div>
              </div>
            )}

            {/* ========================================== */}
            {/* TARJETA 1: DATOS DEL COMPROBANTE          */}
            {/* ========================================== */}
            <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  1. Datos del Comprobante
                </h3>
                <span className="text-[10px] font-semibold text-slate-400">AFIP / ARCA</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Razón Social */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Razón Social Emisor
                  </label>
                  <input
                    type="text"
                    value={invoice.razon_social}
                    disabled={!isEditing}
                    onChange={(e) => handleFieldChange("razon_social", e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-900 shadow-sm transition focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed"
                  />
                </div>

                {/* CUIT Emisor con Botón Copiar */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    CUIT Emisor
                  </label>
                  <div className="relative mt-1">
                    <input
                      type="text"
                      value={invoice.cuit_emisor}
                      disabled={!isEditing}
                      onChange={(e) => handleFieldChange("cuit_emisor", e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 font-mono text-sm font-semibold text-slate-900 shadow-sm pr-10 focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed"
                    />
                    <button
                      type="button"
                      title="Copiar CUIT"
                      onClick={() => copyToClipboard(invoice.cuit_emisor)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    >
                      {copiedCuit ? (
                        <span className="text-[10px] font-bold text-emerald-600">✓</span>
                      ) : (
                        <Icons.Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Fila de 2 Columnas para Fechas */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Fecha de Emisión
                  </label>
                  <input
                    type="date"
                    value={invoice.fecha_emision}
                    disabled={!isEditing}
                    onChange={(e) => handleFieldChange("fecha_emision", e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Fecha Período IVA
                  </label>
                  <input
                    type="date"
                    value={invoice.fecha_imputacion_iva || invoice.fecha_emision}
                    disabled={!isEditing}
                    onChange={(e) => handleFieldChange("fecha_imputacion_iva", e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed"
                  />
                </div>

                {/* Provincia / Jurisdicción */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    Provincia / Jurisdicción
                  </label>
                  <div className="relative mt-1">
                    <input
                      type="text"
                      list="provincias-list"
                      placeholder="Ej: Neuquén, CABA, Buenos Aires..."
                      value={invoice.provincia_facturacion || ""}
                      disabled={!isEditing}
                      onChange={(e) => handleFieldChange("provincia_facturacion", e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed"
                    />
                    <datalist id="provincias-list">
                      {PROVINCIAS_ARGENTINAS.map((p) => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                  </div>
                </div>

                {/* Fila de Moneda y Tipo de Cambio */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Moneda del Comprobante
                  </label>
                  <select
                    value={invoice.moneda}
                    disabled={!isEditing}
                    onChange={(e) => handleFieldChange("moneda", e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-bold text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed"
                  >
                    <option value="ARS">ARS — Peso Argentino ($)</option>
                    <option value="USD">USD — Dólar Estadounidense (u$s)</option>
                  </select>
                </div>

                {invoice.moneda === "USD" ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Tipo de Cambio (Cotización)
                    </label>
                    <div className="relative mt-1">
                      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-sm select-none">$</span>
                      <input
                        type="number"
                        step="0.0001"
                        value={getNumericInputValue(invoice.tipo_cambio)}
                        disabled={!isEditing}
                        onChange={(e) => handleFieldChange("tipo_cambio", Number(e.target.value))}
                        className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3.5 py-2 font-mono text-sm font-bold text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-400">
                      Tipo de Cambio
                    </label>
                    <div className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-100/80 px-3.5 py-2 text-sm text-slate-500 font-mono">
                      1.0000 (Moneda local)
                    </div>
                  </div>
                )}

                {/* CAE y Vencimiento CAE de AFIP */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Código de Autorización (CAE)
                  </label>
                  <input
                    type="text"
                    maxLength={14}
                    placeholder="Ej: 74251928374829"
                    value={invoice.cae || ""}
                    disabled={!isEditing}
                    onChange={(e) => handleFieldChange("cae", e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 font-mono text-sm font-semibold text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Vencimiento CAE
                  </label>
                  <input
                    type="date"
                    value={invoice.fecha_vto_cae || ""}
                    disabled={!isEditing}
                    onChange={(e) => handleFieldChange("fecha_vto_cae", e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 font-mono text-sm font-semibold text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </div>

            {/* ======================================================== */}
            {/* TARJETA 2: NUEVO BLOQUE OTROS TRIBUTOS Y PERCEPCIONES    */}
            {/* ======================================================== */}
            <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  2. Otros Tributos y Percepciones
                </h3>
                <span className="text-[10px] font-semibold text-slate-400">
                  Subtotal: {currencySymbol}{otrosTributosTotal.toFixed(2)}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Percepción IVA */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Percepción IVA ({currencySymbol})
                  </label>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-xs font-semibold select-none">{currencySymbol}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={getNumericInputValue(invoice.percepcion_iva)}
                      disabled={!isEditing}
                      onChange={(e) => handleFieldChange("percepcion_iva", Number(e.target.value))}
                      className={`w-full rounded-xl border border-slate-200 bg-white ${currencyPadding} pr-3.5 py-2 font-mono text-sm font-semibold text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed`}
                    />
                  </div>
                </div>

                {/* Impuestos Internos */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Impuestos Internos ({currencySymbol})
                  </label>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-xs font-semibold select-none">{currencySymbol}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={getNumericInputValue(invoice.impuestos_internos)}
                      disabled={!isEditing}
                      onChange={(e) => handleFieldChange("impuestos_internos", Number(e.target.value))}
                      className={`w-full rounded-xl border border-slate-200 bg-white ${currencyPadding} pr-3.5 py-2 font-mono text-sm font-semibold text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed`}
                    />
                  </div>
                </div>

                {/* Percepción IIBB y Jurisdicción */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Percepción IIBB ({currencySymbol})
                  </label>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-xs font-semibold select-none">{currencySymbol}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={getNumericInputValue(invoice.percepcion_iibb)}
                      disabled={!isEditing}
                      onChange={(e) => handleFieldChange("percepcion_iibb", Number(e.target.value))}
                      className={`w-full rounded-xl border border-slate-200 bg-white ${currencyPadding} pr-3.5 py-2 font-mono text-sm font-semibold text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Jurisdicción IIBB (Provincia)
                  </label>
                  <div className="relative mt-1">
                    <input
                      type="text"
                      list="iibb-jurisdiccion-list"
                      placeholder="Ej: Neuquén, CABA..."
                      value={invoice.iibb_jurisdiccion || ""}
                      disabled={!isEditing}
                      onChange={(e) => handleFieldChange("iibb_jurisdiccion", e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed"
                    />
                    <datalist id="iibb-jurisdiccion-list">
                      {PROVINCIAS_ARGENTINAS.map((p) => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                  </div>
                </div>

                {/* Otras Tasas / No Gravado */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    Otras Tasas / Conceptos No Gravados / Exentos ({currencySymbol})
                  </label>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-xs font-semibold select-none">{currencySymbol}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={getNumericInputValue(invoice.otros_conceptos)}
                      disabled={!isEditing}
                      onChange={(e) => handleFieldChange("otros_conceptos", Number(e.target.value))}
                      className={`w-full rounded-xl border border-slate-200 bg-white ${currencyPadding} pr-3.5 py-2 font-mono text-sm font-semibold text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed`}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ========================================== */}
            {/* TARJETA 3: IMPORTES DECLARADOS            */}
            {/* ========================================== */}
            <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-5 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                3. Importes Declarados ({invoice.moneda})
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Neto Gravado */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Neto Gravado
                  </label>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-xs font-semibold select-none">{currencySymbol}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={getNumericInputValue(invoice.neto_gravado)}
                      disabled={!isEditing}
                      onChange={(e) => handleFieldChange("neto_gravado", Number(e.target.value))}
                      className={`w-full rounded-xl border border-slate-200 bg-white ${currencyPadding} pr-3.5 py-2 font-mono text-sm font-bold text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed`}
                    />
                  </div>
                </div>

                {/* IVA */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    IVA (21% / 10.5%)
                  </label>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-xs font-semibold select-none">{currencySymbol}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={getNumericInputValue(invoice.iva_monto)}
                      disabled={!isEditing}
                      onChange={(e) => handleFieldChange("iva_monto", Number(e.target.value))}
                      className={`w-full rounded-xl border border-slate-200 bg-white ${currencyPadding} pr-3.5 py-2 font-mono text-sm font-bold text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed`}
                    />
                  </div>
                </div>

                {/* Total Final */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Total General
                  </label>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-xs font-semibold select-none">{currencySymbol}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={getNumericInputValue(invoice.total)}
                      disabled={!isEditing}
                      onChange={(e) => handleFieldChange("total", Number(e.target.value))}
                      className={`w-full rounded-xl border border-slate-200 bg-white ${currencyPadding} pr-3.5 py-2 font-mono text-sm font-bold text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100/80 disabled:cursor-not-allowed`}
                    />
                  </div>
                </div>
              </div>

              {/* Conversión y Equivalente en ARS si es USD */}
              {invoice.moneda === "USD" && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3.5 mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold text-indigo-900 block">
                      Total Equivalente en Pesos Argentinos (ARS)
                    </span>
                    <span className="text-[11px] text-indigo-600">
                      Calculado a cotización TC oficial: ${Number(invoice.tipo_cambio || 1.0).toFixed(4)}
                    </span>
                  </div>
                  <div className="font-mono text-base font-extrabold text-indigo-900">
                    $ {totalEnPesosARS.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              )}
            </div>

            {/* Mensaje Informativo */}
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>ⓘ</span>
              <span>
                Datos adaptados a normativa AFIP/ARCA con soporte de múltiples tributos, IIBB provincial y moneda extranjera.
              </span>
            </p>
          </div>

          {/* Barra de Acciones Inferior */}
          <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-5">
            <button
              type="button"
              disabled={isValidatingAfip}
              onClick={handleVerifyAfip}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-800 shadow-sm transition hover:bg-emerald-100 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              title="Contrastar comprobante ante el WSFE oficial de AFIP / ARCA"
            >
              {isValidatingAfip ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-700 border-t-transparent" />
                  <span>Validando con AFIP...</span>
                </>
              ) : (
                <>
                  <Icons.ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <span>Validar con AFIP</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsEditing(!isEditing)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <Icons.Edit className="h-3.5 w-3.5 text-slate-500" />
              <span>{isEditing ? "Bloquear Edición" : "Corregir Datos"}</span>
            </button>

            <button
              type="button"
              disabled={isSaving}
              onClick={handleApproveAndRegister}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-xs font-bold text-white shadow-md shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Registrando Asiento...</span>
                </>
              ) : (
                <>
                  <Icons.CheckCircle className="h-4 w-4" />
                  <span>Aprobar y Registrar Asiento</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
