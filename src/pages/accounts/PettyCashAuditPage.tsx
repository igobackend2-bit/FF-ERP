import React, { useState, useMemo, useEffect } from 'react';
import { usePettyCash } from '@/hooks/usePettyCash';
import { usePettyCashReports, PettyCashReport } from '@/hooks/usePettyCashReports';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import {
    Calendar as CalendarIcon,
    Download,
    Search,
    TrendingDown,
    Wallet,
    ClipboardCheck,
    Eye,
    CheckCircle2,
    ArrowRightLeft,
    Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { exportToCSV } from '@/lib/exportUtils';

const PettyCashAuditPage = () => {
    const { user } = useAuth();
    const isDirector = user?.role?.toLowerCase() === 'director';

    const { entries, isLoading: entriesLoading, getCurrentBalance, getCumulativeSpend } = usePettyCash();
    const {
        reports,
        isLoading: reportsLoading,
        fetchReportLedger,
        updateReportStatus,
        fetchReports,
        refillRequests,
        updateRefillStatus
    } = usePettyCashReports();

    const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
        from: startOfMonth(new Date()),
        to: new Date()
    });
    const [searchQuery, setSearchQuery] = useState('');
    const [currentBalance, setCurrentBalance] = useState<number>(0);
    const [cumulativeSpend, setCumulativeSpend] = useState<number>(0);

    // Modal State
    const [selectedReport, setSelectedReport] = useState<PettyCashReport | null>(null);
    const [reportLedger, setReportLedger] = useState<any[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        getCurrentBalance().then(setCurrentBalance);
        getCumulativeSpend().then(setCumulativeSpend);
    }, []);

    const handleViewReport = async (report: PettyCashReport) => {
        setSelectedReport(report);
        const ledger = await fetchReportLedger(report.id);
        setReportLedger(ledger);
        setIsModalOpen(true);
    };

    const handleApproveReport = async () => {
        if (!selectedReport) return;
        setIsSubmitting(true);
        try {
            // 1. Update report status
            const nextStatus = selectedReport.status === 'draft' ? 'submitted' :
                selectedReport.status === 'submitted' ? 'auditor_reviewed' : 'director_approved';

            const res = await updateReportStatus(selectedReport.id, nextStatus as any);

            if (res.success) {
                // 2. If Director approving, also move the Refill Request forward
                if (nextStatus === 'director_approved') {
                    const refill = refillRequests.find(r => r.report_id === selectedReport.id);
                    if (refill && refill.status === 'pending_director') {
                        await updateRefillStatus(refill.id, 'director_approved');
                    }
                }
                setIsModalOpen(false);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    // Filtered entries based on date range and search
    const filteredEntries = useMemo(() => {
        return entries.filter(entry => {
            const entryDate = parseISO(entry.expense_date);
            const matchesDate = isWithinInterval(entryDate, { start: dateRange.from, end: dateRange.to });
            const matchesSearch = entry.vendor_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                entry.department.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesDate && matchesSearch;
        });
    }, [entries, dateRange, searchQuery]);

    // Grouping entries by day for the summary view
    const dayWiseTotals = useMemo(() => {
        const totals: Record<string, { date: string, amount: number, count: number }> = {};
        filteredEntries.forEach(entry => {
            const dateStr = entry.expense_date;
            if (!totals[dateStr]) {
                totals[dateStr] = { date: dateStr, amount: 0, count: 0 };
            }
            totals[dateStr].amount += Number(entry.amount);
            totals[dateStr].count += 1;
        });
        return Object.values(totals).sort((a, b) => b.date.localeCompare(a.date));
    }, [filteredEntries]);

    const handleExportReport = () => {
        exportToCSV(
            filteredEntries,
            `petty-cash-ledger-${format(dateRange.from, 'yyyyMMdd')}-${format(dateRange.to, 'yyyyMMdd')}`,
            [
                { key: 'expense_date', label: 'Date' },
                { key: 'vendor_name', label: 'Vendor' },
                { key: 'department', label: 'Department' },
                { key: 'amount', label: 'Amount' },
            ]
        );
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Petty Cash Audit</h1>
                    <p className="text-muted-foreground">Detailed visibility into daily expenditures and running balance</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" className="gap-2" onClick={handleExportReport} disabled={filteredEntries.length === 0}>
                        <Download className="w-4 h-4" /> Export Report
                    </Button>
                </div>
            </div>

            {/* Summary Row */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card className="bg-emerald-500/5 border-emerald-500/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Current Balance</CardTitle>
                        <Wallet className="h-4 w-4 text-emerald-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">₹{currentBalance.toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground font-mono">AVAILABLE FUND</p>
                    </CardContent>
                </Card>
                <Card className="bg-amber-500/5 border-amber-500/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Spent (Refill Cycle)</CardTitle>
                        <TrendingDown className="h-4 w-4 text-amber-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">₹{cumulativeSpend.toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground font-mono">TARGET: ₹15,000</p>
                    </CardContent>
                </Card>
                <Card className="bg-blue-500/5 border-blue-500/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Pending Statements</CardTitle>
                        <ClipboardCheck className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{reports.filter(r => r.status !== 'closed').length}</div>
                        <Badge variant="secondary" className="mt-1 font-mono text-[10px]">
                            {reports.filter(r => r.status === 'draft' || r.status === 'submitted').length} ACTION REQUIRED
                        </Badge>
                    </CardContent>
                </Card>
                <Card className="bg-gray-500/5 border-gray-500/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Period Total</CardTitle>
                        <Search className="h-4 w-4 text-gray-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            ₹{filteredEntries.reduce((sum, e) => sum + Number(e.amount), 0).toLocaleString()}
                        </div>
                        <p className="text-xs text-muted-foreground font-mono">{filteredEntries.length} TRANSACTIONS</p>
                    </CardContent>
                </Card>
            </div>

            <Tabs defaultValue="ledger" className="space-y-6">
                <TabsList className="bg-muted/50 p-1">
                    <TabsTrigger value="ledger" className="gap-2">
                        <ArrowRightLeft className="w-4 h-4" /> Transaction Ledger
                    </TabsTrigger>
                    <TabsTrigger value="statements" className="gap-2">
                        <ClipboardCheck className="w-4 h-4" /> Audit Statements
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="ledger" className="space-y-6">
                    {/* Filters */}
                    <Card className="p-4 bg-muted/20 border-border/40">
                        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                            <div className="flex items-center gap-2 w-full md:w-auto">
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" className={cn("w-[240px] justify-start text-left font-normal bg-background", !dateRange && "text-muted-foreground")}>
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {dateRange.from ? format(dateRange.from, "LLL dd, y") : "Pick start date"} - {dateRange.to ? format(dateRange.to, "LLL dd, y") : "Pick end date"}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                            initialFocus
                                            mode="range"
                                            defaultMonth={dateRange.from}
                                            selected={{ from: dateRange.from, to: dateRange.to }}
                                            onSelect={(range: any) => range?.from && range?.to && setDateRange({ from: range.from, to: range.to })}
                                            numberOfMonths={2}
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <div className="relative w-full md:w-80">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search by vendor or department..."
                                    className="pl-8 bg-background"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>
                    </Card>

                    <div className="grid gap-6 lg:grid-cols-3">
                        {/* Day-wise Totals */}
                        <Card className="lg:col-span-1 border-border/40">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Clock className="w-5 h-5 text-primary" /> Day-wise Totals
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <Table>
                                    <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead>Date</TableHead>
                                            <TableHead className="text-right">Total</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {dayWiseTotals.map((day) => (
                                            <TableRow key={day.date} className="hover:bg-primary/5 transition-colors">
                                                <TableCell className="font-medium">{format(parseISO(day.date), 'dd MMM yyyy')}</TableCell>
                                                <TableCell className="text-right font-bold text-primary">₹{day.amount.toLocaleString()}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>

                        {/* Ledger Table */}
                        <Card className="lg:col-span-2 border-border/40">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <ArrowRightLeft className="w-5 h-5 text-primary" /> Full Transaction Ledger
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <Table>
                                    <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead>Vendor</TableHead>
                                            <TableHead>Dept</TableHead>
                                            <TableHead className="text-right">Amount</TableHead>
                                            <TableHead className="text-right">Date</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredEntries.map((entry) => (
                                            <TableRow key={entry.id} className="hover:bg-primary/5 transition-colors group">
                                                <TableCell className="font-medium group-hover:text-primary transition-colors">{entry.vendor_name}</TableCell>
                                                <TableCell><Badge variant="outline" className="font-mono text-[10px]">{entry.department}</Badge></TableCell>
                                                <TableCell className="text-right font-bold text-destructive">₹{entry.amount.toLocaleString()}</TableCell>
                                                <TableCell className="text-right text-muted-foreground font-mono text-xs">
                                                    {format(parseISO(entry.expense_date), 'dd MMM')}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="statements" className="space-y-4">
                    <Card className="border-border/40">
                        <CardHeader>
                            <CardTitle className="text-lg">Audit Statements Queue</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Report #</TableHead>
                                        <TableHead>Period</TableHead>
                                        <TableHead className="text-right">Total Spend</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {reports.map((report) => (
                                        <TableRow key={report.id}>
                                            <TableCell className="font-mono">#{report.id.substring(0, 8)}</TableCell>
                                            <TableCell>
                                                {format(parseISO(report.period_start), 'dd MMM')} - {format(parseISO(report.period_end), 'dd MMM yyyy')}
                                            </TableCell>
                                            <TableCell className="text-right font-bold">₹{Number(report.total_amount).toLocaleString()}</TableCell>
                                            <TableCell>
                                                <Badge variant={report.status === 'draft' ? "outline" : report.status === 'director_approved' ? "default" : "secondary"}>
                                                    {report.status.replace('_', ' ').toUpperCase()}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="gap-2"
                                                    onClick={() => handleViewReport(report)}
                                                >
                                                    <Eye className="w-4 h-4" /> Review Statement
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {reports.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No audit reports found</TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Audit Statement Modal */}
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-2xl">
                            <ClipboardCheck className="w-6 h-6 text-primary" />
                            Petty Cash Audit Statement
                            <Badge className="ml-2 font-mono">#{selectedReport?.id.substring(0, 8)}</Badge>
                        </DialogTitle>
                    </DialogHeader>

                    {selectedReport && (
                        <div className="space-y-6">
                            {/* Statement Summary Section */}
                            <div className="grid grid-cols-3 gap-4 p-6 bg-muted/30 rounded-2xl border border-border/40">
                                <div className="space-y-1">
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Opening Balance</p>
                                    <p className="text-xl font-bold font-mono">₹{Number(selectedReport.opening_balance || 15000).toLocaleString()}</p>
                                    <p className="text-[10px] text-emerald-600 font-medium">FUND REFILLED</p>
                                </div>
                                <div className="space-y-1 text-center">
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Total Utilization</p>
                                    <p className="text-xl font-bold font-mono text-destructive">₹{Number(selectedReport.total_amount).toLocaleString()}</p>
                                    <p className="text-[10px] text-amber-600 font-medium">{reportLedger.length} BATCH TRANSACTIONS</p>
                                </div>
                                <div className="space-y-1 text-right">
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Closing Balance</p>
                                    <p className="text-xl font-bold font-mono text-primary">₹{Number(selectedReport.closing_balance || 0).toLocaleString()}</p>
                                    <p className="text-[10px] text-muted-foreground font-medium uppercase font-mono tracking-tighter">Running Fund</p>
                                </div>
                            </div>

                            {/* Detailed Transaction Ledger */}
                            <div className="space-y-3">
                                <h3 className="font-bold text-sm uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                    <ArrowRightLeft className="w-4 h-4" /> Batch Transaction Details
                                </h3>
                                <div className="rounded-xl border border-border/40 overflow-hidden">
                                    <Table>
                                        <TableHeader className="bg-muted/50">
                                            <TableRow>
                                                <TableHead className="h-10">Vendor / Purpose</TableHead>
                                                <TableHead className="h-10 text-right">Amount</TableHead>
                                                <TableHead className="h-10 text-right">Running</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {reportLedger.map((entry, idx) => (
                                                <TableRow key={entry.id} className="h-12 hover:bg-muted/30">
                                                    <TableCell className="py-2">
                                                        <p className="font-bold text-sm leading-none">{entry.vendor_name}</p>
                                                        <p className="text-[10px] text-muted-foreground mt-1">{entry.purpose}</p>
                                                    </TableCell>
                                                    <TableCell className="text-right font-bold text-destructive">
                                                        ₹{Number(entry.amount).toLocaleString()}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                                        ₹{Number(entry.balance_after).toLocaleString()}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        </div>
                    )}

                    <DialogFooter className="mt-6 border-t pt-6">
                        <Button variant="outline" onClick={() => setIsModalOpen(false)}>Close Statement</Button>
                        {isDirector && selectedReport?.status !== 'director_approved' && (
                            <Button
                                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                                onClick={handleApproveReport}
                                disabled={isSubmitting}
                            >
                                <CheckCircle2 className="w-4 h-4" />
                                {isSubmitting ? "Approving..." : "Approve Audit Statement"}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default PettyCashAuditPage;

