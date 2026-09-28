import { isMissingTable } from '@/lib/supabase-error-guard';
// @ts-nocheck
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import {
  Users,
  DollarSign,
  Calendar,
  Eye,
  Pause,
  CheckCircle2,
  FileCheck,
  Upload,
  Building2,
} from 'lucide-react';
import {
  fetchBatchesForAccounts,
  fetchBatchEmployees,
  setBatchAccountsProcessing,
  setBatchFullyPaid,
  accountsHoldBatch,
  updateBatchEmployeeStatus,
  type SalaryBatchCard,
  type BatchEmployeeRow,
} from '@/modules/hr-payroll/services/salaryBatchWorkflowService';
import { SALARY_BATCH_STATUS, STATUS_BADGE_CLASS } from '@/modules/hr-payroll/lib/salaryBatchWorkflow';
import { supabase } from '@/integrations/supabase/client';
import { generateSalaryKotakFile, parseStatementFile, matchPaymentsWithStatement, type MatchResult } from '@/lib/kotakBankExport';

const fmt = (v: number) =>
  `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function formatDateTime(iso: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function maskAccount(ac: string | null) {
  if (!ac) return '—';
  if (ac.length <= 4) return '****';
  return '****' + ac.slice(-4);
}

export default function AccountsSalaryBatchPage() {
  const queryClient = useQueryClient();
  const [detailBatch, setDetailBatch] = useState<SalaryBatchCard | null>(null);
  const [holdBatch, setHoldBatch] = useState<SalaryBatchCard | null>(null);
  const [holdReason, setHoldReason] = useState('');
  const [employees, setEmployees] = useState<BatchEmployeeRow[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  // Bulk statement upload (match bank-returned UTRs against this batch's employees)
  const [bulkBatch, setBulkBatch] = useState<SalaryBatchCard | null>(null);
  const [bulkEmployees, setBulkEmployees] = useState<BatchEmployeeRow[]>([]);
  const [bulkMatches, setBulkMatches] = useState<MatchResult[] | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['salary-batches-accounts'],
    queryFn: fetchBatchesForAccounts,
  });

  const openDetail = async (batch: SalaryBatchCard) => {
    setDetailBatch(batch);
    setLoadingEmployees(true);
    try {
      const list = await fetchBatchEmployees(batch.id);
      setEmployees(list);
    } catch (e) {
      if (!isMissingTable(error)) toast.error('Failed to load employees');
      setEmployees([]);
    } finally {
      setLoadingEmployees(false);
    }
  };

  const setProcessingMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not logged in');
      await setBatchAccountsProcessing(batchId, user.id);
    },
    onSuccess: () => {
      toast.success('Batch marked as Accounts Processing');
      setDetailBatch(null);
      queryClient.invalidateQueries({ queryKey: ['salary-batches-accounts'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setFullyPaidMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not logged in');
      await setBatchFullyPaid(batchId, user.id);
    },
    onSuccess: () => {
      toast.success('Batch marked as Fully Paid');
      setDetailBatch(null);
      queryClient.invalidateQueries({ queryKey: ['salary-batches-accounts'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const holdMutation = useMutation({
    mutationFn: ({ batchId, reason }: { batchId: string; reason: string }) =>
      accountsHoldBatch(batchId, reason),
    onSuccess: () => {
      toast.success('Batch put on hold');
      setHoldBatch(null);
      setHoldReason('');
      queryClient.invalidateQueries({ queryKey: ['salary-batches-accounts'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleDownloadKotakFile = async (batch: SalaryBatchCard) => {
    try {
      // Fetch employees for this batch
      const list = await fetchBatchEmployees(batch.id);
      if (!list || list.length === 0) {
        toast.error('No employees found in this batch');
        return;
      }

      // Validate employees have required bank details
      const invalid: { name: string; reason: string }[] = [];
      list.forEach(emp => {
        if (!emp.account_number || emp.account_number.trim().length < 5) {
          invalid.push({ name: emp.employee_name || 'Unknown', reason: 'Missing or invalid account number' });
        } else if (!emp.ifsc_code || emp.ifsc_code.trim().length < 5) {
          invalid.push({ name: emp.employee_name || 'Unknown', reason: 'Missing or invalid IFSC code' });
        } else if (!emp.net_pay || emp.net_pay <= 0) {
          invalid.push({ name: emp.employee_name || 'Unknown', reason: 'Missing or invalid net pay amount' });
        }
      });

      if (invalid.length > 0) {
        toast.error(`${invalid.length} employee(s) missing bank details. Please edit batch to fix.`);
        console.error('Employees with missing bank details:', invalid);
        return;
      }

      // Generate and download Kotak file
      generateSalaryKotakFile(list, batch.batch_code);
      toast.success('Kotak bulk payment file downloaded');
    } catch (error) {
      console.error('Failed to generate Kotak file:', error);
      toast.error('Failed to generate Kotak file');
    }
  };

  const openBulkDialog = async (batch: SalaryBatchCard) => {
    setBulkBatch(batch);
    setBulkMatches(null);
    try {
      const list = await fetchBatchEmployees(batch.id);
      setBulkEmployees(list);
    } catch (e) {
      toast.error('Failed to load employees for this batch');
      setBulkEmployees([]);
    }
  };

  const handleBulkStatementFile = async (file: File) => {
    setBulkUploading(true);
    try {
      const rows = await parseStatementFile(file);
      const forExport = bulkEmployees.map((e) => ({
        id: e.id,
        amount: Number(e.net_pay ?? 0),
        vendor_name: e.employee_name ?? 'Unknown',
        vendor_account_number: e.account_number ?? undefined,
      }));
      const results = matchPaymentsWithStatement(forExport, rows);
      setBulkMatches(results);
    } catch (e: any) {
      toast.error(e.message || 'Failed to read statement');
    } finally {
      setBulkUploading(false);
    }
  };

  const confirmBulkMatches = async () => {
    if (!bulkMatches) return;
    setBulkSaving(true);
    try {
      const matched = bulkMatches.filter((m) => m.matchedUTR);
      for (const m of matched) {
        const { error } = await supabase
          .from('salary_batch_employees')
          .update({ utr_number: m.matchedUTR, updated_at: new Date().toISOString() })
          .eq('id', m.paymentId);
        if (error) throw error;
      }
      toast.success(`${matched.length} of ${bulkMatches.length} employee(s) matched and saved`);
      setBulkBatch(null);
      setBulkMatches(null);
    } catch (e: any) {
      toast.error(e.message || 'Failed to save matched UTRs');
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Accounts Salary Execution</h1>
        <p className="text-muted-foreground">
          View CEO-approved batches, payment details, mark hold/paid, and attach bulk payment files.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Batches for Payment</CardTitle>
          <CardDescription>
            CEO Approved, On Hold, and Fully Paid batches. View details, mark hold, or mark paid.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading batches…</p>
          ) : batches.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">
              No batches for accounts at the moment.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {batches.map((batch) => (
                <Card key={batch.id} className="flex flex-col">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base">{batch.batch_code}</CardTitle>
                      <Badge className={statusBadgeClass(batch.status)}>{batch.status}</Badge>
                    </div>
                    <CardDescription className="flex items-center gap-1">
                      <Building2 className="w-3 h-3" />
                      {batch.departments_display}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <span>{batch.total_employees} employees</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <DollarSign className="w-4 h-4 text-muted-foreground" />
                      <span>Net: {fmt(batch.total_net_pay ?? 0)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="w-4 h-4" />
                      <span>{formatDateTime(batch.updated_at)}</span>
                    </div>
                    {batch.ceo_rejected_reason && (
                      <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                        CEO Rejected: {batch.ceo_rejected_reason}
                      </p>
                    )}
                    {batch.ceo_hold_reason && (
                      <p className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
                        CEO Hold: {batch.ceo_hold_reason}
                      </p>
                    )}
                    {batch.accounts_hold_reason && (
                      <p className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
                        Accounts Hold: {batch.accounts_hold_reason}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button variant="outline" size="sm" onClick={() => openDetail(batch)}>
                        <Eye className="w-3 h-3 mr-1" />
                        View details
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setHoldBatch(batch)}
                      >
                        <Pause className="w-3 h-3 mr-1" />
                        Mark Hold
                      </Button>
                      {(batch.status === SALARY_BATCH_STATUS.CEO_APPROVED ||
                        batch.status === SALARY_BATCH_STATUS.ACCOUNTS_PROCESSING) && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setProcessingMutation.mutate(batch.id)}
                            disabled={setProcessingMutation.isPending}
                          >
                            Processing
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => setFullyPaidMutation.mutate(batch.id)}
                            disabled={setFullyPaidMutation.isPending}
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Mark Paid
                          </Button>
                        </>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownloadKotakFile(batch)}
                        disabled={batch.total_employees === 0}
                      >
                        <FileCheck className="w-3 h-3 mr-1" />
                        Kotak File
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openBulkDialog(batch)}
                        disabled={batch.total_employees === 0}
                        title="Upload the bank's returned statement to match UTRs against employees"
                      >
                        <Upload className="w-3 h-3 mr-1" />
                        Bulk file
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Batch detail modal with payment details */}
      <Dialog open={!!detailBatch} onOpenChange={() => setDetailBatch(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Batch details — Payment view</DialogTitle>
            <DialogDescription>
              Employee list with bank details and payment status. Mark Paid / Mark Paid Already when done.
            </DialogDescription>
          </DialogHeader>
          {detailBatch && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4 text-sm">
                <span><strong>Batch:</strong> {detailBatch.batch_code}</span>
                <span><strong>Net pay:</strong> {fmt(detailBatch.total_net_pay ?? 0)}</span>
                <span><strong>Employees:</strong> {detailBatch.total_employees}</span>
              </div>
              {loadingEmployees ? (
                <p className="text-muted-foreground">Loading employees…</p>
              ) : (
                <div className="border rounded-md overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Bank</TableHead>
                        <TableHead>Account (masked)</TableHead>
                        <TableHead>IFSC</TableHead>
                        <TableHead className="text-right">Net pay</TableHead>
                        <TableHead>Payment status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employees.map((emp) => (
                        <TableRow key={emp.id}>
                          <TableCell className="font-medium">{emp.employee_name ?? '—'}</TableCell>
                          <TableCell>
                            <span className="text-sm">
                              <span className="text-muted-foreground">Department: </span>
                              <span className="font-medium">{emp.department ?? 'Not Assigned'}</span>
                            </span>
                          </TableCell>
                          <TableCell>{emp.bank_name ?? '—'}</TableCell>
                          <TableCell className="font-mono text-xs">{maskAccount(emp.account_number)}</TableCell>
                          <TableCell className="font-mono text-xs">{emp.ifsc_code ?? '—'}</TableCell>
                          <TableCell className="text-right font-mono">{fmt(emp.net_pay ?? 0)}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-xs">{emp.status ?? 'Pending'}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailBatch(null)}>Close</Button>
            {detailBatch &&
              (detailBatch.status === SALARY_BATCH_STATUS.CEO_APPROVED ||
                detailBatch.status === SALARY_BATCH_STATUS.ACCOUNTS_PROCESSING) && (
                <Button
                  onClick={() => setFullyPaidMutation.mutate(detailBatch.id)}
                  disabled={setFullyPaidMutation.isPending}
                >
                  Mark Fully Paid
                </Button>
              )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Hold modal */}
      <Dialog open={!!holdBatch} onOpenChange={(open) => !open && setHoldBatch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark batch on hold</DialogTitle>
            <DialogDescription>Hold reason is mandatory.</DialogDescription>
          </DialogHeader>
          {holdBatch && (
            <>
              <p className="text-sm">Batch: <strong>{holdBatch.batch_code}</strong></p>
              <div className="space-y-2">
                <Label htmlFor="accounts-hold-reason">Hold reason *</Label>
                <Textarea
                  id="accounts-hold-reason"
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  placeholder="Enter reason..."
                  rows={4}
                  className="resize-none"
                />
              </div>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setHoldBatch(null); setHoldReason(''); }}>Cancel</Button>
            <Button
              onClick={() =>
                holdBatch &&
                holdReason.trim() &&
                holdMutation.mutate({ batchId: holdBatch.id, reason: holdReason.trim() })
              }
              disabled={!holdReason.trim() || holdMutation.isPending}
            >
              {holdMutation.isPending ? 'Saving…' : 'Mark Hold'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk file — upload bank statement, match UTRs against employees */}
      <Dialog open={!!bulkBatch} onOpenChange={(open) => { if (!open) { setBulkBatch(null); setBulkMatches(null); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk file — match UTRs</DialogTitle>
            <DialogDescription>
              Upload the bank's returned statement for {bulkBatch?.batch_code}. Employees are matched by amount, account number and name, the same way vendor payment batches are matched.
            </DialogDescription>
          </DialogHeader>

          {!bulkMatches ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{bulkEmployees.length} employee(s) in this batch.</p>
              <label className="flex items-center justify-center gap-2 px-4 py-6 rounded-lg border-2 border-dashed border-muted-foreground/30 text-sm font-medium cursor-pointer hover:bg-muted/30">
                {bulkUploading ? 'Reading statement…' : 'Choose bank statement (.xlsx, .xls, .csv, .pdf)'}
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf"
                  className="hidden"
                  disabled={bulkUploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBulkStatementFile(f); e.target.value = ''; }}
                />
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-muted-foreground">
                {bulkMatches.filter((m) => m.status === 'matched').length}/{bulkMatches.length} matched confidently
              </p>
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Matched UTR</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bulkMatches.map((m) => (
                      <TableRow key={m.paymentId}>
                        <TableCell>{m.vendorName}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(m.amount)}</TableCell>
                        <TableCell className="font-mono text-xs">{m.matchedUTR || '—'}</TableCell>
                        <TableCell>
                          <Badge variant={m.status === 'matched' ? 'default' : m.status === 'partial' ? 'secondary' : 'outline'}>
                            {m.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkBatch(null); setBulkMatches(null); }}>Cancel</Button>
            {bulkMatches && (
              <Button onClick={confirmBulkMatches} disabled={bulkSaving}>
                {bulkSaving ? 'Saving…' : 'Save matched UTRs'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
