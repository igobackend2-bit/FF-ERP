import { useState, useRef, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  Camera, CheckCircle2, XCircle, AlertTriangle, Scale,
  ClipboardCheck, ChevronDown, ChevronUp, RefreshCw, X, Image,
} from 'lucide-react';
import WebcamCaptureModal from '@/components/WebcamCaptureModal';

// input[type=file][capture] only opens a real camera on mobile -- desktop
// browsers ignore `capture` entirely and show the OS file picker. Coarse
// pointer (touch, no hover) is the standard feature-detect for "this is a
// touchscreen device", so mobile keeps using its native-camera file input
// (already correct there) while desktop gets the WebcamCaptureModal instead.
const isTouchDevice = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

type QCGrade = 'A' | 'B' | 'C' | 'D';

interface ChecklistItem {
  key:   string;
  label: string;
}

const CHECKLIST_ITEMS: ChecklistItem[] = [
  { key: 'freshness',   label: 'Freshness — no signs of wilting or decay' },
  { key: 'colour',      label: 'Colour — matches expected colour for product' },
  { key: 'smell',       label: 'Smell — no off or fermented odour' },
  { key: 'firmness',    label: 'Firmness — appropriate texture for grade' },
  { key: 'packaging',   label: 'Packaging — no damage, contamination or leakage' },
];

interface QCFormData {
  product_id:      string;
  vendor_id:       string;
  po_item_id?:     string;
  transit_id?:     string;
  gross_weight_kg: number;
  tare_weight_kg:  number;
  grade_a_kg:      number;
  grade_b_kg:      number;
  grade_c_kg:      number;
  grade_d_kg:      number;
  overall_grade:   QCGrade;
  rejection_reason?: string;
  defect_notes?:   string;
}

const GRADE_CONFIG: Record<QCGrade, { label: string; color: string; bg: string; description: string }> = {
  A: { label: 'Grade A', color: 'text-green-700',  bg: 'bg-green-50 border-green-200',  description: 'Fresh, no defects — Full price' },
  B: { label: 'Grade B', color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200', description: 'Minor defects — 10-15% discount' },
  C: { label: 'Grade C', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200', description: 'Visible damage — QC channel price' },
  D: { label: 'Grade D', color: 'text-red-700',    bg: 'bg-red-50 border-red-200',       description: 'Reject — Return to vendor' },
};

function GradeCard({ grade, selected, onClick }: { grade: QCGrade; selected: boolean; onClick: () => void }) {
  const cfg = GRADE_CONFIG[grade];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border-2 p-4 text-left transition-all ${
        selected ? `${cfg.bg} border-current ${cfg.color} shadow-sm` : 'border-gray-200 hover:border-gray-300 bg-white'
      }`}
    >
      <p className={`text-lg font-bold ${selected ? cfg.color : 'text-gray-800'}`}>{cfg.label}</p>
      <p className={`text-xs mt-1 ${selected ? cfg.color : 'text-gray-500'}`}>{cfg.description}</p>
    </button>
  );
}

export default function QCInspection() {
  const { user } = useAuth();
  const hubId = (user as any)?.hub_id ?? null;
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedGrade, setSelectedGrade]       = useState<QCGrade>('A');
  const [step, setStep]                          = useState<'form' | 'review' | 'result'>('form');
  const [lastResult, setLastResult]              = useState<any>(null);
  const [checklist, setChecklist]                = useState<Record<string, boolean>>({});
  const [photos, setPhotos]                      = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls]  = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos]    = useState(false);
  const [showChecklist, setShowChecklist]        = useState(true);
  const [showWebcam, setShowWebcam]              = useState(false);

  // Pre-fill from URL params (coming from transit record detail)
  const preTransitId = searchParams.get('transit_id') ?? '';
  const prePoId      = searchParams.get('po_id') ?? '';

  const { register, handleSubmit, watch, reset, setValue, formState: { errors } } = useForm<QCFormData>({
    defaultValues: {
      tare_weight_kg: 0, grade_a_kg: 0, grade_b_kg: 0, grade_c_kg: 0, grade_d_kg: 0,
      transit_id: preTransitId,
    },
  });

  const gross      = watch('gross_weight_kg') || 0;
  const tare       = watch('tare_weight_kg')  || 0;
  const netWeight  = gross - tare;
  const gradeA     = watch('grade_a_kg') || 0;
  const gradeB     = watch('grade_b_kg') || 0;
  const gradeC     = watch('grade_c_kg') || 0;
  const gradeD     = watch('grade_d_kg') || 0;
  const gradedTotal = gradeA + gradeB + gradeC + gradeD;
  const acceptancePct = netWeight > 0 ? ((gradeA + gradeB + gradeC) / netWeight) * 100 : 0;
  const checklistPassed = CHECKLIST_ITEMS.filter(i => checklist[i.key]).length;

  // Products & Vendors
  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      // sku_code isn't a live column on products (confirmed by every other page in
      // this app selecting name/category/unit/grade_a_price but never sku_code) —
      // selecting it here was throwing a PostgREST error on every load, and since
      // the error was never checked, the dropdown just silently rendered empty.
      const { data, error } = await supabase.from('products').select('id,name,unit').eq('is_active', true).order('name');
      if (error) { toast.error(`Failed to load products: ${error.message}`); throw error; }
      return data ?? [];
    },
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('id,name').eq('is_active', true).order('name');
      if (error) { toast.error(`Failed to load vendors: ${error.message}`); throw error; }
      return data ?? [];
    },
  });

  const [addingProduct, setAddingProduct] = useState(false);
  const [newProductName, setNewProductName] = useState('');

  const createProduct = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from('products')
        .insert({ name: name.trim(), unit: 'kg', is_active: true })
        .select('id,name,unit')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (created) => {
      queryClient.setQueryData(['products'], (prev: any[] = []) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setValue('product_id', created.id);
      setAddingProduct(false);
      setNewProductName('');
      toast.success(`Added "${created.name}" — selected for this inspection`);
    },
    onError: (e: any) => toast.error(`Failed to add product: ${e.message}`),
  });

  // PO Items from transit record's PO
  const { data: poItems = [] } = useQuery({
    queryKey: ['po-items-for-qc', prePoId],
    enabled: !!prePoId,
    queryFn: async () => {
      const { data } = await supabase
        .from('purchase_order_items')
        .select('id, item_name, quantity, unit')
        .eq('purchase_order_id', prePoId);
      return data ?? [];
    },
  });

  // Photo handling
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    addPhotos(files);
  };

  const addPhotos = (files: File[]) => {
    const newPhotos = [...photos, ...files].slice(0, 5); // max 5
    setPhotos(newPhotos);
    const urls = newPhotos.map(f => URL.createObjectURL(f));
    setPhotoPreviewUrls(urls);
  };

  const openPhotoCapture = () => {
    if (isTouchDevice()) fileInputRef.current?.click();
    else setShowWebcam(true);
  };

  const removePhoto = (idx: number) => {
    const updated = photos.filter((_, i) => i !== idx);
    setPhotos(updated);
    setPhotoPreviewUrls(updated.map(f => URL.createObjectURL(f)));
  };

  // Upload photos to Supabase Storage. Throws on any failure: this used to swallow the error,
  // and because the qc-photos bucket did not exist every inspection was saved with no photos
  // while the hub manager believed they had been uploaded.
  const uploadPhotos = async (): Promise<string[]> => {
    if (!photos.length) return [];
    setUploadingPhotos(true);
    try {
      const urls: string[] = [];
      for (const file of photos) {
        const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
        const path = `${hubId ?? 'hub'}/${Date.now()}-${safeName}`;
        const { data, error } = await supabase.storage
          .from('qc-photos')
          .upload(path, file, { upsert: false });
        if (error || !data) {
          console.error('[QCInspection] photo upload failed:', error);
          throw new Error(`Photo upload failed (${file.name}): ${error?.message ?? 'no response'}. Nothing was saved — try again, or remove the photos to continue without them.`);
        }
        const { data: pub } = supabase.storage.from('qc-photos').getPublicUrl(data.path);
        if (!pub?.publicUrl) throw new Error(`Photo upload failed (${file.name}): no link was returned.`);
        urls.push(pub.publicUrl);
      }
      return urls;
    } finally {
      setUploadingPhotos(false);
    }
  };

  // Generate sequential GRN via DB function
  const generateGRN = async (): Promise<string> => {
    const { data, error } = await supabase.rpc('next_grn_number');
    if (error || !data) return `GRN-${Date.now()}`;
    return data as string;
  };

  const createQC = useMutation({
    mutationFn: async (data: QCFormData) => {
      // Photos first: if an upload fails nothing is saved and no GRN number is used up.
      const photoUrls  = await uploadPhotos();
      const grnNumber  = await generateGRN();

      const checklistJson: Record<string, boolean> = {};
      CHECKLIST_ITEMS.forEach(i => { checklistJson[i.key] = checklist[i.key] ?? false; });

      const { data: inspection, error } = await supabase.from('qc_inspections').insert({
        grn_number:            grnNumber,
        hub_id:                hubId,
        product_id:            data.product_id,
        vendor_id:             data.vendor_id,
        po_item_id:            data.po_item_id || null,
        transit_record_id:     data.transit_id  || null,
        inspector_id:          user!.id,
        gross_weight_kg:       data.gross_weight_kg,
        tare_weight_kg:        data.tare_weight_kg,
        grade_a_kg:            data.grade_a_kg,
        grade_b_kg:            data.grade_b_kg,
        grade_c_kg:            data.grade_c_kg,
        grade_d_kg:            data.grade_d_kg,
        overall_grade:         selectedGrade,
        acceptance_pct:        acceptancePct,
        rejection_reason:      data.rejection_reason,
        defect_notes:          data.defect_notes,
        inspection_checklist:  checklistJson,
        photo_urls:            photoUrls,
        review_status:         'submitted',
        status:                gradeD > 0 && (gradeA + gradeB + gradeC) === 0 ? 'rejected' : gradeD > 0 ? 'partial' : 'accepted',
      }).select().single();

      if (error) throw error;

      // Update transit record to 'in_qc'
      if (data.transit_id) {
        await supabase
          .from('transit_records')
          .update({ status: 'in_qc' })
          .eq('id', data.transit_id)
          .eq('status', 'arrived');
      }

      // Update inventory
      if (gradeA + gradeB + gradeC > 0) {
        const stockArgs = {
          p_hub_id:     hubId,
          p_product_id: data.product_id,
          p_grade_a:    data.grade_a_kg,
          p_grade_b:    data.grade_b_kg,
          p_grade_c:    data.grade_c_kg,
        };
        // The inspection id lets the stock ledger link this receipt to its GRN. If the database has not
        // been updated yet (PGRST202 = function with that signature not found) retry the original call so
        // QC never breaks during the rollout.
        let { error: invErr } = await (supabase as any).rpc('increment_inventory', { ...stockArgs, p_inspection_id: inspection.id });
        if (invErr?.code === 'PGRST202') {
          ({ error: invErr } = await (supabase as any).rpc('increment_inventory', stockArgs));
        }
        if (invErr) throw new Error(`Inventory update failed: ${invErr.message}`);
      }

      // Create rejection record if Grade D
      if (gradeD > 0) {
        await supabase.from('qc_rejections').insert({
          qc_inspection_id: inspection.id,
          vendor_id:        data.vendor_id,
          product_id:       data.product_id,
          rejected_kg:      gradeD,
          rejection_reason: data.rejection_reason || 'Grade D — substandard quality',
          return_status:    'pending',
        });
      }

      return { inspection, grnNumber };
    },
    onSuccess: ({ inspection, grnNumber }) => {
      toast.success(`QC Inspection ${grnNumber} recorded!`);
      setLastResult({ ...inspection, grnNumber });
      setStep('result');
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['qc-inspections'] });
      queryClient.invalidateQueries({ queryKey: ['transit-today'] });
    },
    onError: (err: Error) => {
      toast.error(`Failed: ${err.message}`);
    },
  });

  const onSubmit = (data: QCFormData) => {
    const total = (Number(data.grade_a_kg) || 0) +
                  (Number(data.grade_b_kg) || 0) +
                  (Number(data.grade_c_kg) || 0) +
                  (Number(data.grade_d_kg) || 0);
    // A 0 kg net weight used to pass the check below (0 = 0), saving an "accepted"
    // GRN that added nothing to inventory — e.g. gross and tare both typed as the weight.
    if (!(netWeight > 0)) {
      toast.error(`Net weight is ${netWeight.toFixed(1)} kg — Tare (${Number(tare).toFixed(1)}) must be less than Gross (${Number(gross).toFixed(1)}). Nothing was saved.`);
      return;
    }
    if (Math.abs(total - netWeight) > 0.1) {
      toast.error(`Weight mismatch! Graded total (${total.toFixed(1)} kg) must match Net weight (${netWeight.toFixed(1)} kg)`);
      return;
    }
    createQC.mutate({ ...data, overall_grade: selectedGrade });
  };

  const handleNewInspection = () => {
    reset();
    setSelectedGrade('A');
    setStep('form');
    setLastResult(null);
    setChecklist({});
    setPhotos([]);
    setPhotoPreviewUrls([]);
  };

  // ── RESULT SCREEN ─────────────────────────────────────────
  if (step === 'result' && lastResult) {
    const isRejected = lastResult.status === 'rejected';
    const isPartial  = lastResult.status === 'partial';

    return (
      <div className="max-w-lg mx-auto pt-4">
        <div className={`rounded-2xl border-2 p-8 text-center ${
          isRejected ? 'border-red-200 bg-red-50' : isPartial ? 'border-orange-200 bg-orange-50' : 'border-green-200 bg-green-50'
        }`}>
          {isRejected
            ? <XCircle    className="h-16 w-16 text-red-500 mx-auto mb-4" />
            : isPartial
            ? <AlertTriangle className="h-16 w-16 text-orange-500 mx-auto mb-4" />
            : <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
          }
          <h2 className="text-xl font-bold text-gray-900 mb-1">
            {isRejected ? 'Batch Rejected' : isPartial ? 'Partial Acceptance' : 'Batch Accepted'}
          </h2>
          <p className="text-sm text-gray-600 mb-6">GRN: <strong>{lastResult.grnNumber}</strong></p>

          <div className="grid grid-cols-2 gap-3 text-left mb-6">
            {[
              { label: 'Net Weight',         value: `${lastResult.net_weight_kg ?? netWeight.toFixed(1)} kg` },
              { label: 'Acceptance',         value: `${acceptancePct.toFixed(1)}%` },
              { label: 'Grade A',            value: `${lastResult.grade_a_kg} kg` },
              { label: 'Grade B',            value: `${lastResult.grade_b_kg} kg` },
              { label: 'Grade C',            value: `${lastResult.grade_c_kg} kg` },
              { label: 'Grade D (Rejected)', value: `${lastResult.grade_d_kg} kg` },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white rounded-lg p-3">
                <p className="text-xs text-gray-500">{label}</p>
                <p className="font-bold text-gray-800">{value}</p>
              </div>
            ))}
          </div>

          {lastResult.photo_urls?.length > 0 && (
            <div className="mb-6 text-left">
              <p className="text-xs text-gray-500 mb-2">Photos saved ({lastResult.photo_urls.length})</p>
              <div className="flex flex-wrap gap-2">
                {lastResult.photo_urls.map((u: string) => (
                  <a key={u} href={u} target="_blank" rel="noopener noreferrer">
                    <img src={u} alt="QC photo" className="h-16 w-16 rounded-lg object-cover border border-white" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {lastResult.grade_d_kg > 0 && (
            <div className="rounded-lg bg-red-100 p-3 text-sm text-red-700 mb-4">
              ⚠️ {lastResult.grade_d_kg} kg rejected.{' '}
              <Link to="/warehouse/qc-rejections" className="underline font-semibold">
                View Rejections
              </Link>{' '}
              to create a deduction memo.
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={handleNewInspection}
              className="w-full rounded-lg bg-green-600 px-4 py-3 font-medium text-white hover:bg-green-700 transition-colors"
            >
              New QC Inspection
            </button>
            {preTransitId && (
              <Link
                to={`/transit/${preTransitId}`}
                className="block text-sm text-blue-600 hover:underline"
              >
                ← Back to Transit Record
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── FORM ─────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12 pt-4">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5 text-green-600" />
        <div>
          <h2 className="text-xl font-bold text-gray-900">QC Inspection</h2>
          <p className="text-sm text-gray-500">Record quality check for incoming goods</p>
        </div>
      </div>

      {/* Transit Link Banner */}
      {preTransitId && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-blue-500 flex-shrink-0" />
          <p className="text-sm text-blue-700">
            Linked to transit arrival record.{' '}
            <Link to={`/transit/${preTransitId}`} className="underline font-medium">View transit →</Link>
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

        {/* Batch Details */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h3 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">Batch Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Product *</label>
              <select {...register('product_id', { required: true })}
                onChange={e => { if (e.target.value === '__add_new__') { setAddingProduct(true); setValue('product_id', ''); } }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="">Select product</option>
                {(products as any[]).map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}{p.unit ? ` (${p.unit})` : ''}</option>
                ))}
                <option value="__add_new__">+ Add new product…</option>
              </select>
              {errors.product_id && <p className="text-xs text-red-500 mt-1">Required</p>}
              {addingProduct && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    autoFocus
                    value={newProductName}
                    onChange={e => setNewProductName(e.target.value)}
                    placeholder="New product name"
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <button
                    type="button"
                    disabled={!newProductName.trim() || createProduct.isPending}
                    onClick={() => createProduct.mutate(newProductName)}
                    className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-40"
                  >
                    {createProduct.isPending ? 'Adding…' : 'Add'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAddingProduct(false); setNewProductName(''); }}
                    className="px-2 py-1.5 rounded-lg text-gray-400 hover:text-gray-600 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vendor *</label>
              <select {...register('vendor_id', { required: true })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="">Select vendor</option>
                {(vendors as any[]).map((v: any) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
              {errors.vendor_id && <p className="text-xs text-red-500 mt-1">Required</p>}
            </div>
          </div>

          {/* PO Item Link (if came from transit) */}
          {(poItems as any[]).length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">PO Item (optional)</label>
              <select {...register('po_item_id')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="">— Select PO item —</option>
                {(poItems as any[]).map((item: any) => (
                  <option key={item.id} value={item.id}>
                    {item.item_name} ({Number(item.quantity)} {item.unit})
                  </option>
                ))}
              </select>
            </div>
          )}

          <input type="hidden" {...register('transit_id')} />
        </div>

        {/* Weight Measurement */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h3 className="font-semibold text-gray-800 text-sm uppercase tracking-wide flex items-center gap-2">
            <Scale className="h-4 w-4" /> Weight Measurement
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gross (kg) *</label>
              <input type="number" step="0.1" min="0"
                {...register('gross_weight_kg', { required: true, valueAsNumber: true })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="0.0" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tare (kg)</label>
              <input type="number" step="0.1" min="0"
                {...register('tare_weight_kg', { valueAsNumber: true })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="0.0" />
            </div>
            <div className="flex flex-col justify-end">
              <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2">
                <p className="text-xs text-green-600 font-medium">Net Weight</p>
                <p className="text-xl font-bold text-green-700">{netWeight.toFixed(1)} kg</p>
              </div>
            </div>
          </div>
        </div>

        {/* Inspection Checklist */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowChecklist(v => !v)}
            className="w-full flex items-center justify-between px-5 py-4 text-left"
          >
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">Inspection Checklist</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                checklistPassed === CHECKLIST_ITEMS.length
                  ? 'bg-green-100 text-green-700'
                  : checklistPassed > 0
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                {checklistPassed}/{CHECKLIST_ITEMS.length} passed
              </span>
            </div>
            {showChecklist ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
          </button>
          {showChecklist && (
            <div className="px-5 pb-4 space-y-3 border-t border-gray-100 pt-3">
              {CHECKLIST_ITEMS.map(item => (
                <label key={item.key} className="flex items-center gap-3 cursor-pointer group">
                  <div
                    onClick={() => setChecklist(prev => ({ ...prev, [item.key]: !prev[item.key] }))}
                    className={`h-5 w-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all cursor-pointer ${
                      checklist[item.key]
                        ? 'bg-green-500 border-green-500'
                        : 'border-gray-300 group-hover:border-green-400'
                    }`}
                  >
                    {checklist[item.key] && (
                      <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className={`text-sm ${checklist[item.key] ? 'text-green-700 font-medium' : 'text-gray-600'}`}>
                    {item.label}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Overall Grade */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h3 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">Overall Grade</h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(['A', 'B', 'C', 'D'] as QCGrade[]).map(grade => (
              <GradeCard key={grade} grade={grade} selected={selectedGrade === grade} onClick={() => setSelectedGrade(grade)} />
            ))}
          </div>
        </div>

        {/* Grade Breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">Grade Breakdown (kg)</h3>
            {gradedTotal > 0 && (
              <span className={`text-xs font-medium ${Math.abs(gradedTotal - netWeight) > 0.5 ? 'text-red-600' : 'text-green-600'}`}>
                Total: {gradedTotal.toFixed(1)} / {netWeight.toFixed(1)} kg
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {(['A', 'B', 'C', 'D'] as QCGrade[]).map(grade => {
              const cfg = GRADE_CONFIG[grade];
              return (
                <div key={grade}>
                  <label className={`block text-xs font-semibold mb-1 ${cfg.color}`}>{cfg.label} (kg)</label>
                  <input
                    type="number" step="0.1" min="0"
                    {...register(`grade_${grade.toLowerCase()}_kg` as any, { valueAsNumber: true })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="0.0"
                  />
                </div>
              );
            })}
          </div>
          {netWeight > 0 && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Acceptance Rate</span>
                <span className="font-semibold">{acceptancePct.toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded-full bg-gray-200">
                <div
                  className={`h-2 rounded-full transition-all ${acceptancePct >= 80 ? 'bg-green-500' : acceptancePct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.min(acceptancePct, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Rejection Details */}
        {(selectedGrade === 'C' || selectedGrade === 'D' || gradeD > 0) && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h3 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">Rejection Details</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rejection Reason *</label>
              <select {...register('rejection_reason')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="">Select reason</option>
                <option value="Over-ripe / Spoiled">Over-ripe / Spoiled</option>
                <option value="Physical damage">Physical damage</option>
                <option value="Wrong product">Wrong product</option>
                <option value="Underweight">Underweight</option>
                <option value="Contamination">Contamination</option>
                <option value="Colour mismatch">Colour mismatch</option>
                <option value="Off smell">Off smell</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Defect Notes</label>
              <textarea {...register('defect_notes')} rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                placeholder="Describe the defects…" />
            </div>
          </div>
        )}

        {/* Photo Capture */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-800 text-sm uppercase tracking-wide flex items-center gap-2">
              <Camera className="h-4 w-4" /> Batch Photos
              <span className="text-xs text-gray-400 font-normal normal-case">({photos.length}/5)</span>
            </h3>
            {photos.length < 5 && (
              <button
                type="button"
                onClick={openPhotoCapture}
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium"
              >
                <Image className="h-3.5 w-3.5" /> Add Photo
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            // No `multiple` here on purpose: pairing it with `capture` makes most
            // mobile browsers fall back to a generic upload/gallery chooser instead
            // of launching the camera directly. handlePhotoChange already appends
            // to the existing photos array, so "Add Photo" tapped repeatedly still
            // builds up to 5 photos -- one camera capture at a time. This input is
            // only ever triggered on touch devices (see openPhotoCapture) -- desktop
            // uses WebcamCaptureModal instead, since capture is silently ignored there.
            capture="environment"
            onChange={handlePhotoChange}
            className="hidden"
          />
          <WebcamCaptureModal
            open={showWebcam}
            onClose={() => setShowWebcam(false)}
            onCapture={file => addPhotos([file])}
          />
          {photoPreviewUrls.length === 0 ? (
            <button
              type="button"
              onClick={openPhotoCapture}
              className="w-full border-2 border-dashed border-gray-200 rounded-xl p-6 text-center hover:border-gray-300 transition-colors"
            >
              <Camera className="h-8 w-8 text-gray-300 mx-auto mb-1" />
              <p className="text-sm text-gray-400">Tap to capture or upload photos</p>
            </button>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {photoPreviewUrls.map((url, i) => (
                <div key={i} className="relative">
                  <img src={url} alt={`Photo ${i + 1}`} className="h-20 w-20 object-cover rounded-lg border border-gray-200" />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full h-5 w-5 flex items-center justify-center hover:bg-red-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={createQC.isPending || uploadingPhotos}
          className="w-full rounded-xl bg-green-600 px-6 py-3.5 font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {createQC.isPending || uploadingPhotos
            ? <><RefreshCw className="h-4 w-4 animate-spin" /> {uploadingPhotos ? 'Uploading photos…' : 'Saving…'}</>
            : '✓ Submit QC Inspection'}
        </button>
      </form>
    </div>
  );
}
