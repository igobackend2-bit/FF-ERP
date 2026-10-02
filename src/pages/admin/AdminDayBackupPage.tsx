import { useState } from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { DatabaseBackup, Loader2, ShieldAlert, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAuth } from '@/contexts/AuthContext';
import {
  runBackup, logBackupDownload, BACKUP_RPC_MISSING,
  type BackupScope, type BackupProgress, type BackupResult, type TableStatus,
} from '@/lib/dayBackup';

const STATUS_STYLE: Record<TableStatus, { label: string; cls: string }> = {
  ok:       { label: 'Complete',            cls: 'text-emerald-700 bg-emerald-50' },
  mismatch: { label: 'Missing rows',        cls: 'text-red-700 bg-red-50' },
  failed:   { label: 'Failed',              cls: 'text-red-700 bg-red-50' },
  skipped:  { label: 'Skipped (logs)',      cls: 'text-slate-600 bg-slate-100' },
  empty:    { label: 'Empty',               cls: 'text-slate-500 bg-slate-50' },
};

export default function AdminDayBackupPage() {
  const { user } = useAuth();
  const [scope, setScope] = useState<BackupScope>('full');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [includeHeavy, setIncludeHeavy] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [result, setResult] = useState<BackupResult | null>(null);
  const [rpcMissing, setRpcMissing] = useState(false);

  const handleDownload = async () => {
    if (!user) return;
    setRunning(true);
    setResult(null);
    setRpcMissing(false);
    setProgress(null);
    try {
      const res = await runBackup({
        scope,
        date: scope === 'day' ? date : undefined,
        includeHeavy,
        generatedBy: user.name || 'Admin',
        onProgress: setProgress,
      });
      setResult(res);

      const logged = await logBackupDownload(
        { id: user.id, name: user.name || 'Admin', role: user.role },
        scope,
        scope === 'day' ? date : null,
        res,
      );
      if (!logged) toast.warning('Backup downloaded, but the download could not be recorded in the audit log.');

      if (res.incomplete) toast.error('Backup downloaded but INCOMPLETE — see the table list below.');
      else toast.success(`Backup downloaded: ${res.totalRows.toLocaleString('en-IN')} rows`);
    } catch (e: any) {
      if (e?.message === BACKUP_RPC_MISSING) {
        setRpcMissing(true);
      } else {
        console.error('[AdminDayBackup] failed:', e);
        toast.error(`Backup failed: ${e?.message || 'unknown error'}`);
      }
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const shownTables = (result?.tables ?? []).filter(t => t.status !== 'empty');
  const emptyCount = (result?.tables ?? []).filter(t => t.status === 'empty').length;
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
          <DatabaseBackup className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Day Backup</h1>
          <p className="text-[13px] text-muted-foreground">
            Download every module — sales, purchase, stock, payments, accounts and more — as one ZIP file.
          </p>
        </div>
      </div>

      {rpcMissing && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>One-time setup needed</AlertTitle>
          <AlertDescription>
            The backup functions are not in the database yet. Run <code>ADD_ADMIN_DAY_BACKUP_RPC_2026-10-02.sql</code> in
            the Supabase SQL Editor, then try again.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What to download</CardTitle>
          <CardDescription>Take a full backup every day and keep it somewhere safe.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <RadioGroup value={scope} onValueChange={v => setScope(v as BackupScope)} className="space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <RadioGroupItem value="full" id="scope-full" className="mt-1" />
              <span>
                <span className="block text-sm font-medium">Full backup (recommended)</span>
                <span className="block text-xs text-muted-foreground">
                  Every row of every table as of now — your complete data.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <RadioGroupItem value="day" id="scope-day" className="mt-1" />
              <span className="flex-1">
                <span className="block text-sm font-medium">One day's activity</span>
                <span className="block text-xs text-muted-foreground">
                  Only records created or changed on the chosen date (India time). Useful for checking a day, not a
                  replacement for the full backup.
                </span>
              </span>
            </label>
          </RadioGroup>

          {scope === 'day' && (
            <div className="max-w-[220px]">
              <Label htmlFor="backup-date" className="text-xs">Date</Label>
              <Input
                id="backup-date" type="date" value={date} max={format(new Date(), 'yyyy-MM-dd')}
                onChange={e => setDate(e.target.value)} className="mt-1"
              />
            </div>
          )}

          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox checked={includeHeavy} onCheckedChange={c => setIncludeHeavy(c === true)} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Include location and analytics logs</span>
              <span className="block text-xs text-muted-foreground">
                GPS tracking and app analytics — thousands of rows and most of the file size. Off by default.
              </span>
            </span>
          </label>

          <Button onClick={handleDownload} disabled={running || (scope === 'day' && !date)} className="gap-2">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <DatabaseBackup className="w-4 h-4" />}
            {running ? 'Preparing backup…' : 'Download backup'}
          </Button>

          {running && progress && (
            <div className="space-y-2">
              <Progress value={progress.phase === 'tables' ? pct : progress.phase === 'zip' ? 100 : 0} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {progress.phase === 'tables'
                  ? `Exporting ${progress.current} (${progress.done + 1} of ${progress.total})`
                  : progress.current}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {result.incomplete
                ? <XCircle className="w-5 h-5 text-red-600" />
                : <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
              {result.incomplete ? 'Backup incomplete' : 'Backup complete'}
            </CardTitle>
            <CardDescription>
              {result.fileName} · {result.totalRows.toLocaleString('en-IN')} rows
              {emptyCount > 0 && ` · ${emptyCount} empty tables left out`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {result.incomplete && (
              <Alert variant="destructive" className="mb-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Some tables did not export fully. The file was still saved and its name ends in INCOMPLETE. Try again;
                  if it repeats, send this list to support.
                </AlertDescription>
              </Alert>
            )}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">Module</th>
                    <th className="text-left px-3 py-2">Table</th>
                    <th className="text-right px-3 py-2">Expected</th>
                    <th className="text-right px-3 py-2">Exported</th>
                    <th className="text-left px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shownTables.map(t => (
                    <tr key={t.table} className="border-t">
                      <td className="px-3 py-1.5 text-muted-foreground">{t.module.replace('_', ' & ')}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">
                        {t.table}
                        {scope === 'day' && !t.dayFiltered && (
                          <span className="ml-2 text-[10px] text-muted-foreground">whole table</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{t.expected.toLocaleString('en-IN')}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{t.exported.toLocaleString('en-IN')}</td>
                      <td className="px-3 py-1.5">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[t.status].cls}`}
                          title={t.error}
                        >
                          {STATUS_STYLE[t.status].label}
                        </span>
                        {t.error && <span className="ml-2 text-[11px] text-red-600">{t.error}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Keep the file safe</AlertTitle>
        <AlertDescription>
          The backup contains bank details, phone numbers and financial records. Save it in a secure, access-controlled
          folder and don't share it by email or chat. Photos and other uploaded files are not inside the ZIP — only their
          links are — and login passwords are never included.
        </AlertDescription>
      </Alert>
    </motion.div>
  );
}
