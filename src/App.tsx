import { useState, useEffect, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AlertProvider } from "@/components/AlertProvider";
import { ChatOverlayProvider } from "@/contexts/ChatOverlayContext";
import { AppLayout } from "@/components/layout/AppLayout";
// Work Order and Purchase Order are now auto-generated from Material Requests
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CafeLiveFlash } from "@/components/cafe/CafeLiveFlash";
import { useCafeRealtime } from "@/hooks/useCafeRealtime";


import { Loader2 } from "lucide-react";

// ── Farmers Factory ERP Modules ──────────────────────────────────────────────

// Purchase Module
const FreshPurchaseDashboard = lazy(() => import('./pages/purchase/FreshPurchaseDashboard'));
const PurchaseOrderForm = lazy(() => import('./pages/purchase/PurchaseOrderForm'));
const VendorManagement = lazy(() => import('./pages/purchase/VendorManagement'));
const RateComparison = lazy(() => import('./pages/purchase/RateComparison'));
const MarketRateEntry = lazy(() => import('./pages/purchase/MarketRateEntry'));
const DemandForecast = lazy(() => import('./pages/purchase/DemandForecast'));
const VendorPayments = lazy(() => import('./pages/purchase/VendorPayments'));
const VendorPerformance = lazy(() => import('./pages/purchase/VendorPerformance'));
const BillCollection = lazy(() => import('./pages/purchase/BillCollection'));

// Warehouse / QC Module
const WarehouseDashboard = lazy(() => import('./pages/warehouse/WarehouseDashboard'));
const QCInspection = lazy(() => import('./pages/warehouse/QCInspection'));
const InventoryDashboard = lazy(() => import('./pages/warehouse/InventoryDashboard'));
const DailyStockPage = lazy(() => import('./pages/warehouse/DailyStockPage'));
const DamageEntryPage = lazy(() => import('./pages/warehouse/DamageEntryPage'));
const EODWastageEntryPage = lazy(() => import('./pages/warehouse/EODWastageEntryPage'));
const ReturnsDashboard = lazy(() => import('./pages/warehouse/ReturnsDashboard'));
const QCRejections = lazy(() => import('./pages/warehouse/QCRejections'));
const POAssignment = lazy(() => import('./pages/warehouse/POAssignment'));
const POAssignmentHistory = lazy(() => import('./pages/warehouse/POAssignmentHistory'));

// Payment Approval Module
const VendorPaymentForm = lazy(() => import('./pages/purchase/VendorPaymentForm'));
const PaymentApprovalQueue = lazy(() => import('./pages/purchase/PaymentApprovalQueue'));
const FinancePaymentProcessPage = lazy(() => import('./pages/finance/FinancePaymentProcessPage'));

// Sales Module
const SalesDashboard = lazy(() => import('./pages/sales/SalesDashboard'));
const NewOrder = lazy(() => import('./pages/sales/NewOrder'));
const BulkOrderPage = lazy(() => import('./pages/sales/BulkOrderPage'));
const OrderListPage = lazy(() => import('./pages/sales/OrderListPage'));
const OrderDetail = lazy(() => import('./pages/sales/OrderDetail'));
const CustomerManagement = lazy(() => import('./pages/sales/CustomerManagement'));
const CollectionManagement = lazy(() => import('./pages/sales/CollectionManagement'));
const SalesTargets = lazy(() => import('./pages/sales/SalesTargets'));
const CollectionEntryPage = lazy(() => import('./pages/collections/CollectionEntryPage'));
const CollectionDashboardPage = lazy(() => import('./pages/collections/CollectionDashboardPage'));

// Tele-Caller Module
const TeleCallerDashboard = lazy(() => import('./pages/tele-caller/TeleCallerDashboard'));
const ShopProfile = lazy(() => import('./pages/tele-caller/ShopProfile'));
const TakeOrder = lazy(() => import('./pages/tele-caller/TakeOrder'));

// Logistics Module
const LogisticsDashboard = lazy(() => import('./pages/logistics/LogisticsDashboard'));
const TripDetail = lazy(() => import('./pages/logistics/TripDetail'));
const DriverView = lazy(() => import('./pages/logistics/DriverView'));

// Catalog Module
const ProductCatalogPage = lazy(() => import('./pages/catalog/ProductCatalog'));
const ProductFormPage = lazy(() => import('./pages/catalog/ProductForm'));

// Reports Module
const ReportsDashboard = lazy(() => import('./pages/reports/ReportsDashboard'));
const PLReport = lazy(() => import('./pages/reports/PLReport'));
const BalanceSheetReport = lazy(() => import('./pages/reports/BalanceSheetReport'));
const CustomReportBuilder = lazy(() => import('./pages/reports/CustomReportBuilder'));
const PurchaseReportPage      = lazy(() => import('./pages/reports/PurchaseReportPage'));
const DailySalesReportPage    = lazy(() => import('./pages/reports/DailySalesReportPage'));
const InventoryReportPage     = lazy(() => import('./pages/reports/InventoryReportPage'));
const DeliveryReportPage      = lazy(() => import('./pages/reports/DeliveryReportPage'));
const AttendanceReportPage    = lazy(() => import('./pages/reports/AttendanceReportPage'));
const CashCollectionReportPage = lazy(() => import('./pages/reports/CashCollectionReportPage'));

// Hub Management Module
const HubManagementPage = lazy(() => import('./pages/admin/HubManagementPage'));
const AdminQCOverviewPage = lazy(() => import('./pages/admin/AdminQCOverviewPage'));

// Finance Module (FF ERP)
const FinanceDashboard = lazy(() => import('./pages/finance/FinanceDashboard'));
const FFOperationsHomePage = lazy(() => import('./pages/ff-operations/FFOperationsHomePage'));
const ItemsPage             = lazy(() => import('./pages/ff-operations/items/ItemsPage'));
const SmartInventoryPage   = lazy(() => import('./pages/ff-operations/inventory/SmartInventoryPage'));
const GMOperationsDashboard = lazy(() => import('./pages/ff-operations/gm/GMOperationsDashboard'));
const DayKPIsPage           = lazy(() => import('./pages/ff-operations/DayKPIsPage'));
const EODPOEngine           = lazy(() => import('./pages/ff-operations/po-engine/EODPOEngine'));

// ── Phase 3: New FF ERP Pages ────────────────────────────────
const FFPaymentApprovals      = lazy(() => import('./pages/ff-operations/FFPaymentApprovals'));
const ExecutionDeskPage       = lazy(() => import('./pages/accounts/ExecutionDeskPage'));
const BatchHistoryPage        = lazy(() => import('./pages/accounts/BatchHistoryPage'));
const TaskAssign              = lazy(() => import('./pages/ff-operations/TaskAssign'));
const TaskToday               = lazy(() => import('./pages/sales/TaskToday'));
const AppOrdersDashboard      = lazy(() => import('./pages/sales/AppOrdersDashboard'));
const CEOFFOverview           = lazy(() => import('./pages/ceo/CEOFFOverview'));
// ── Phase 4: Payment Submission Forms ────────────────────────
const FFVendorPaymentForm     = lazy(() => import('./pages/ff-operations/FFVendorPaymentForm'));
const FFTransportPaymentForm  = lazy(() => import('./pages/ff-operations/FFTransportPaymentForm'));
const MySubmittedPayments     = lazy(() => import('./pages/ff-operations/MySubmittedPayments'));
// ── Phase 5: Reports upgrade ─────────────────────────────────
const FFPaymentsReport        = lazy(() => import('./pages/reports/FFPaymentsReport'));

// FF Operations — Purchase sub-pages
const PurchaseVendorsPage      = lazy(() => import('./pages/ff-operations/purchase/PurchaseVendorsPage'));
const PurchaseExpensesPage     = lazy(() => import('./pages/ff-operations/purchase/PurchaseExpensesPage'));
const RecurringExpensesPage    = lazy(() => import('./pages/ff-operations/purchase/RecurringExpensesPage'));
const PurchaseOrdersPage       = lazy(() => import('./pages/ff-operations/purchase/PurchaseOrdersPage'));
const PurchaseBillsPage        = lazy(() => import('./pages/ff-operations/purchase/PurchaseBillsPage'));
const PurchaseInvoicesPage     = lazy(() => import('./pages/ff-operations/purchase/PurchaseInvoicesPage'));
const RecurringBillsPage       = lazy(() => import('./pages/ff-operations/purchase/RecurringBillsPage'));
const PaymentsMadePage         = lazy(() => import('./pages/ff-operations/purchase/PaymentsMadePage'));
const VendorCreditsPage        = lazy(() => import('./pages/ff-operations/purchase/VendorCreditsPage'));
const AutoPOPage               = lazy(() => import('./pages/ff-operations/purchase/AutoPOPage'));
const AutoBillPage             = lazy(() => import('./pages/ff-operations/purchase/AutoBillPage'));
const BuyPage                  = lazy(() => import('./pages/ff-operations/purchase/BuyPage'));
const POBuysReview             = lazy(() => import('./pages/ff-operations/purchase/POBuysReview'));
const VendorBulkPaymentPage    = lazy(() => import('./pages/ff-operations/purchase/VendorBulkPaymentPage'));
const DebitNotesPage           = lazy(() => import('./pages/ff-operations/purchase/DebitNotesPage'));

// FF Operations — Sales sub-pages
const SalesCustomersPage       = lazy(() => import('./pages/ff-operations/sales/SalesCustomersPage'));
const SalesOrdersPage          = lazy(() => import('./pages/ff-operations/sales/SalesOrdersPage'));
const SalesInvoicesPage        = lazy(() => import('./pages/ff-operations/sales/SalesInvoicesPage'));
const RecurringInvoicesPage    = lazy(() => import('./pages/ff-operations/sales/RecurringInvoicesPage'));
const DeliveryChallansPage     = lazy(() => import('./pages/ff-operations/sales/DeliveryChallansPage'));
const PaymentsReceivedPage     = lazy(() => import('./pages/ff-operations/sales/PaymentsReceivedPage'));
const CreditNotesPage          = lazy(() => import('./pages/ff-operations/sales/CreditNotesPage'));

// Customer Portal (PUBLIC — rendered outside AppLayout)
const CustomerPortal = lazy(() => import('./pages/customer/CustomerPortal'));

// Engineering Module Pages

const RentalPaymentHistoryPage = lazy(() => import('./pages/rentals/RentalPaymentHistoryPage'));
const CEORentalApprovalPage = lazy(() => import('./pages/rentals/CEORentalApprovalPage'));
const CEORentalPortfolioPage = lazy(() => import('./pages/rentals/CEORentalPortfolioPage'));
const AccountsRentalPaymentPage = lazy(() => import('./pages/rentals/AccountsRentalPaymentPage'));

// Shift Module Pages

// Shift Module Pages

// Public Pages (No Auth Required)
import { preloadCustomTones } from '@/lib/alertSounds';
import { useLocationTracking } from '@/hooks/useLocationTracking';
import { useRouteGuardStatus } from '@/hooks/useRouteGuardStatus';
import { WeeklyAchievementsDashboard } from './pages/admin/WeeklyAchievementsDashboard';

const lazyNamed = <TModule extends Record<string, unknown>, TKey extends keyof TModule>(
  loader: () => Promise<TModule>,
  exportName: TKey
) =>
  lazy(async () => {
    const module = await loader();
    return { default: module[exportName] as ComponentType<any> };
  });

const LoginPage = lazyNamed(() => import('@/pages/LoginPage'), 'LoginPage');
const EmployeeSignupPage = lazyNamed(() => import('@/pages/EmployeeSignupPage'), 'EmployeeSignupPage');
const RedirectPage = lazyNamed(() => import('@/pages/RedirectPage'), 'RedirectPage');
const DayStartPage = lazyNamed(() => import('@/pages/employee/DayStartPage'), 'DayStartPage');
const EmployeeDashboardPage = lazyNamed(() => import('@/pages/employee/EmployeeDashboardPage'), 'EmployeeDashboardPage');
const DayPlanPage = lazyNamed(() => import('@/pages/employee/DayPlanPage'), 'DayPlanPage');
const HourlyReportPage = lazyNamed(() => import('@/pages/employee/HourlyReportPage'), 'HourlyReportPage');
const EODSummaryPage = lazyNamed(() => import('@/pages/employee/EODSummaryPage'), 'EODSummaryPage');
const PaymentRequestPage = lazyNamed(() => import('@/pages/employee/PaymentRequestPage'), 'PaymentRequestPage');
const MyRequestsPage = lazyNamed(() => import('@/pages/employee/MyRequestsPage'), 'MyRequestsPage');
const EmployeeProjectsPage = lazyNamed(() => import('@/pages/employee/EmployeeProjectsPage'), 'EmployeeProjectsPage');
const ProfilePage = lazyNamed(() => import('@/pages/employee/ProfilePage'), 'ProfilePage');
const AdminEmployeeProfilePage = lazyNamed(() => import('@/pages/admin/AdminEmployeeProfilePage'), 'AdminEmployeeProfilePage');
const LeaveRequestPage = lazy(() => import('@/pages/employee/LeaveRequestPage'));
const BOQReviewPage = lazy(() => import('./pages/engineering/BOQReviewPage'));
const MyTasksPage = lazy(() => import('@/pages/employee/MyTasksPage'));
const MySOPsPage = lazyNamed(() => import('@/pages/employee/MySOPsPage'), 'MySOPsPage');
const SelfieViewingPage = lazyNamed(() => import('@/pages/hr/SelfieViewingPage'), 'SelfieViewingPage');
const EmployeeActivityPage = lazy(() => import('@/pages/hr/EmployeeActivityPage'));
const LOPManagementPage = lazy(() => import('@/pages/hr/LOPManagementPage'));
const LeaveApprovalsPage = lazy(() => import('@/pages/hr/LeaveApprovalsPage'));
const HRPaymentAuditPage = lazy(() => import('@/pages/hr/HRPaymentAuditPage'));
const HRDashboardPage = lazyNamed(() => import('@/pages/hr/HRDashboardPage'), 'HRDashboardPage');
const AdminQueuePage = lazyNamed(() => import('@/pages/admin/AdminQueuePage'), 'AdminQueuePage');
const PaymentSearchPage = lazyNamed(() => import('@/pages/admin/PaymentSearchPage'), 'PaymentSearchPage');
const UserManagementPage = lazyNamed(() => import('@/pages/admin/UserManagementPage'), 'UserManagementPage');
const DepartmentManagementPage = lazyNamed(() => import('@/pages/admin/DepartmentManagementPage'), 'DepartmentManagementPage');
const AdminSOPManagementPage = lazyNamed(() => import('@/pages/admin/AdminSOPManagementPage'), 'AdminSOPManagementPage');
const CEODashboardPage = lazyNamed(() => import('@/pages/ceo/CEODashboardPage'), 'CEODashboardPage');
const CEOApprovalsPage = lazyNamed(() => import('@/pages/ceo/CEOApprovalsPage'), 'CEOApprovalsPage');
const CEOSalaryApprovalPage = lazy(() => import('@/pages/ceo/CEOSalaryApprovalPage'));
const CEOIntelligencePage = lazy(() => import('@/pages/ceo/CEOIntelligencePage'));
const PalmCafeAnalysis = lazyNamed(() => import('@/pages/ceo/PalmCafeAnalysis'), 'PalmCafeAnalysis');
const CEODepartmentPage = lazyNamed(() => import('@/pages/ceo/CEODepartmentPage'), 'CEODepartmentPage');
const CEOWorkOrdersPage = lazy(() => import('@/pages/ceo/CEOWorkOrdersPage'));
const CEOMaterialsPage = lazy(() => import('@/pages/ceo/CEOMaterialsPage'));
const CEOLOPReversalsPage = lazy(() => import('@/pages/ceo/CEOLOPReversalsPage'));
const AccountsExecutionPage = lazyNamed(() => import('@/pages/accounts/AccountsExecutionPage'), 'AccountsExecutionPage');
const AccountsSalaryExecutionPage = lazy(() => import('@/pages/accounts/AccountsSalaryExecutionPage'));
const AccountsSalarySheetPage = lazy(() => import('@/pages/accounts/AccountsSalarySheetPage'));
const AccountsSalaryBatchPage = lazy(() => import('@/pages/accounts/AccountsSalaryBatchPage'));
const EmployeeManagement = lazy(() => import('@/pages/admin/EmployeeManagement'));
const AuditLogPage = lazyNamed(() => import('@/pages/audit/AuditLogPage'), 'AuditLogPage');
const AdminPaymentsPage = lazyNamed(() => import('@/pages/admin/AdminPaymentsPage'), 'AdminPaymentsPage');
const AdminDashboardPage = lazyNamed(() => import('@/pages/admin/AdminDashboardPage'), 'AdminDashboardPage');
const AdminOrdersQueuePage = lazyNamed(() => import('@/pages/admin/AdminOrdersQueuePage'), 'AdminOrdersQueuePage');
const AdminProjectIntakePage = lazy(() => import('@/pages/admin/AdminProjectIntakePage'));
const AdminWorkOrdersPage = lazy(() => import('@/pages/admin/AdminWorkOrdersPage'));
const AdminProcurementPage = lazy(() => import('@/pages/admin/AdminProcurementPage'));
const CEOProcurementPage = lazy(() => import('@/pages/ceo/CEOProcurementPage'));
const AttendanceCalendarPage = lazyNamed(() => import('@/pages/shared/AttendanceCalendarPage'), 'AttendanceCalendarPage');
const ProjectsPage = lazyNamed(() => import('@/pages/admin/ProjectsPage'), 'ProjectsPage');
const ProjectFormPage = lazyNamed(() => import('@/pages/admin/ProjectFormPage'), 'ProjectFormPage');
const EmployeeDirectoryPage = lazyNamed(() => import('@/pages/admin/EmployeeDirectoryPage'), 'EmployeeDirectoryPage');
const TaskAssignmentPage = lazy(() => import('@/pages/admin/TaskAssignmentPage'));
const AnnouncementsPage = lazy(() => import('@/pages/admin/AnnouncementsPage'));
const RoleManagementPage = lazy(() => import('@/pages/admin/RoleManagementPage'));
const AdminLOPListPage = lazy(() => import('@/pages/admin/AdminLOPListPage'));
const AdminEscalationClosurePage = lazy(() => import('@/pages/admin/AdminEscalationClosurePage'));
const AdminCriticalsAuditPage = lazy(() => import('@/pages/admin/AdminCriticalsAuditPage'));
const WeekOffManagementPage = lazy(() => import('@/pages/admin/WeekOffManagementPage'));
const FixVerticalsPage = lazyNamed(() => import('@/pages/admin/FixVerticalsPage'), 'FixVerticalsPage');
const AdminCronJobsPage = lazy(() => import('@/pages/admin/AdminCronJobsPage'));
const AdminDayBackupPage = lazy(() => import('@/pages/admin/AdminDayBackupPage'));
const OverviewPage = lazy(() => import('@/pages/overview/OverviewPage'));
const AdminShiftUserManagementPage = lazy(() => import('@/pages/admin/AdminShiftUserManagementPage'));
const AdminShiftAttendancePage = lazy(() => import('@/pages/admin/AdminShiftAttendancePage'));
const AdminNotificationTonesPage = lazy(() => import('@/pages/admin/AdminNotificationTonesPage'));
const ERPIntelligencePage = lazy(() => import('@/pages/admin/ERPIntelligencePage'));
const AICommandCenter = lazy(() => import('@/pages/admin/AICommandCenter'));
const AdminAuditorPaymentAuditPage = lazy(() => import('@/pages/admin/AdminAuditorPaymentAuditPage'));
const JVDirectorDashboard = lazy(() => import('@/pages/jv/JVDirectorDashboard'));
const NotFound = lazy(() => import('./pages/NotFound'));
const SystemDocumentationPage = lazy(() => import('@/pages/SystemDocumentationPage'));
const GMDashboardPage = lazy(() => import('@/pages/gm/GMDashboardPage'));
const GMEscalationsPage = lazy(() => import('@/pages/gm/GMEscalationsPage'));
const BOIDashboardPage = lazy(() => import('@/pages/boi/BOIDashboardPage'));
const BOIPaymentsPage = lazy(() => import('@/pages/boi/BOIPaymentsPage'));
const GMODashboardPage = lazy(() => import('@/pages/gmo/GMODashboardPage'));
const GMOTicketsPage = lazy(() => import('@/pages/gmo/GMOTicketsPage'));
const GMOProjectsPage = lazy(() => import('@/pages/gmo/GMOProjectsPage'));
const GMOTasksPage = lazy(() => import('@/pages/gmo/GMOTasksPage'));
const SMODashboardPage = lazy(() => import('@/pages/smo/SMODashboardPage'));
const SMOTicketsPage = lazy(() => import('@/pages/smo/SMOTicketsPage'));
const SMOProjectsPage = lazy(() => import('@/pages/smo/SMOProjectsPage'));
const SMOTasksPage = lazy(() => import('@/pages/smo/SMOTasksPage'));
const SMOPaymentsPage = lazy(() => import('@/pages/smo/SMOPaymentsPage'));
const GMOPaymentsPage = lazy(() => import('@/pages/gmo/GMOPaymentsPage'));
const GMOProjectFinancialsPage = lazy(() => import('@/pages/gmo/GMOProjectFinancialsPage'));
const GMOEngineeringTeamPage = lazy(() => import('@/pages/gmo/GMOEngineeringTeamPage'));
const GMPaymentsPage = lazy(() => import('@/pages/gm/GMPaymentsPage'));
const ReconciliationHubPage = lazy(() => import('@/pages/accounts/ReconciliationHubPage'));
const NSMDashboardPage = lazy(() => import('@/pages/nsm/NSMDashboardPage'));
const DataTeamDashboardPage = lazy(() => import('@/pages/datateam/DataTeamDashboardPage'));
const DataTeamWOAuditPage = lazy(() => import('@/pages/datateam/DataTeamWOAuditPage'));
const CEOEscalationsPage = lazy(() => import('@/pages/ceo/CEOEscalationsPage'));
const UnifiedEscalationsPage = lazy(() => import('@/pages/shared/UnifiedEscalationsPage'));
const MyEscalationsPage = lazy(() => import('@/pages/shared/MyEscalationsPage'));
const CompanyCalendarPage = lazy(() => import('@/pages/common/CompanyCalendarPage'));
const LOPReversalPage = lazy(() => import('@/pages/employee/LOPReversalPage'));
const DealUploadPage = lazy(() => import('@/pages/engineering/DealUploadPage'));
const BOQBuilderPage = lazy(() => import('@/pages/engineering/BOQBuilderPage'));
const BOQBuilderLandingPage = lazy(() => import('@/pages/engineering/BOQBuilderLandingPage'));
const EngineerDashboardPage = lazy(() => import('@/pages/engineering/EngineerDashboardPage'));
const GMONewDealsPage = lazy(() => import('@/pages/gmo/GMONewDealsPage'));
const BOQApprovalsPage = lazy(() => import('@/pages/smo/BOQApprovalsPage'));
const GMOBOQApprovalsPage = lazy(() => import('@/pages/gmo/GMOBOQApprovalsPage'));
const ProjectExecutionDashboard = lazy(() => import('@/pages/engineering/ProjectExecutionDashboard'));
const SourcingDashboard = lazy(() => import('@/pages/engineering/SourcingDashboard'));
const ProjectCommandPage = lazy(() => import('@/pages/admin/ProjectCommandPage'));
const PurchaseDashboard = lazy(() => import('@/pages/purchase/PurchaseDashboard'));
const SiteManagerDashboard = lazy(() => import('@/pages/site/SiteManagerDashboard'));
const VendorSourcingDashboard = lazy(() => import('@/pages/vendor/VendorSourcingDashboard'));
const FarmManagerDashboard = lazy(() => import('@/pages/farm/FarmManagerDashboard'));
const ProjectInventoryPage = lazy(() => import('@/pages/inventory/ProjectInventoryPage'));
const AuditorDashboardPage = lazy(() => import('@/pages/auditor/AuditorDashboardPage'));
const AuditorPaymentAuditPage = lazy(() => import('@/pages/auditor/AuditorPaymentAuditPage'));
const ChatPage = lazy(() => import('./pages/chat/ChatPage'));
const PettyCashAuditPage = lazy(() => import('@/pages/accounts/PettyCashAuditPage'));
const DailyCashClosingPage = lazy(() => import('@/pages/accounts/DailyCashClosingPage'));
const FixedAssetRegisterPage = lazy(() => import('@/pages/accounts/FixedAssetRegisterPage'));
const VehicleManagementPage = lazy(() => import('@/pages/admin/VehicleManagementPage'));
const CrateTrackingPage = lazy(() => import('@/pages/admin/CrateTrackingPage'));
const AssetTransfersPage = lazy(() => import('@/pages/admin/AssetTransfersPage'));
const AssetVerificationPage = lazy(() => import('@/pages/admin/AssetVerificationPage'));
const AssetLookupPage = lazy(() => import('@/pages/admin/AssetLookupPage'));
const PettyCashRefillPage = lazy(() => import('@/pages/accounts/PettyCashRefillPage'));
// Books of Accounts (double-entry ledger — ADD_ACCOUNTS_LEDGER_CORE.sql)
const ChartOfAccountsPage = lazy(() => import('@/pages/accounts/books/ChartOfAccountsPage'));
const BooksDayBookPage = lazy(() => import('@/pages/accounts/books/DayBookPage'));
const JournalEntryPage = lazy(() => import('@/pages/accounts/books/JournalEntryPage'));
const GeneralLedgerPage = lazy(() => import('@/pages/accounts/books/GeneralLedgerPage'));
const TrialBalancePage = lazy(() => import('@/pages/accounts/books/TrialBalancePage'));
const FinancialStatementsPage = lazy(() => import('@/pages/accounts/books/FinancialStatementsPage'));
const AgeingPage = lazy(() => import('@/pages/accounts/books/AgeingPage'));
const BooksSettingsPage = lazy(() => import('@/pages/accounts/books/BooksSettingsPage'));
const PartiesPage = lazy(() => import('@/pages/accounts/books/PartiesPage'));
const PartyStatementsPage = lazy(() => import('@/pages/accounts/books/PartyStatementsPage'));
const BankReconciliationPage = lazy(() => import('@/pages/accounts/books/BankReconciliationPage'));
const DirectorDailyWorkflow = lazy(() => import('@/pages/director/DirectorDailyWorkflow'));
const DirectorSalaryAuditPage = lazy(() => import('@/pages/director/DirectorSalaryAuditPage'));
const DirectorMealOrderingPage = lazy(() => import('@/pages/director/DirectorMealOrderingPage').then(m => ({ default: m.DirectorMealOrderingPage })));
const ProjectSpendingPage = lazy(() => import('@/pages/finance/ProjectSpendingPage'));
const ProjectProcurementPage = lazy(() => import('@/pages/admin/ProjectProcurementPage'));
const AdminLockoutManagementPage = lazy(() => import('@/pages/admin/AdminLockoutManagementPage'));
const AdminRentalSetupPage = lazy(() => import('./pages/admin/AdminRentalSetupPage'));
const AdminRentalDashboard = lazy(() => import('./pages/admin/AdminRentalDashboard'));
const RSHRentalDashboard = lazy(() => import('./pages/rentals/RSHRentalDashboard'));
const RSHEscalationDashboard = lazy(() => import('./pages/rsh/RSHEscalationDashboard'));
const AdminGeofencePage = lazy(() => import('@/pages/admin/AdminGeofencePage'));
const AttendanceRosterPage = lazy(() => import('@/pages/admin/AttendanceRosterPage'));
const AdminRentalCategoryPage = lazy(() => import('./pages/admin/AdminRentalCategoryPage'));
const RentalPropertyFormPage = lazy(() => import('./pages/rentals/RentalPropertyFormPage'));
const RentalBulkRaisePage = lazy(() => import('./pages/rentals/RentalBulkRaisePage'));
const PaymentTagsPage = lazy(() => import('@/pages/admin/PaymentTagsPage'));
const PaymentGuardianDashboard = lazyNamed(() => import('@/pages/admin/PaymentGuardianDashboard'), 'PaymentGuardianDashboard');
const TransportAnalysisDashboard = lazyNamed(() => import('@/pages/admin/TransportAnalysisDashboard'), 'TransportAnalysisDashboard');
const ShiftDashboardPage = lazy(() => import('@/pages/shift/ShiftDashboardPage'));
const ShiftLoginPage = lazy(() => import('@/pages/shift/ShiftLoginPage'));
const ShiftHourlyPage = lazy(() => import('@/pages/shift/ShiftHourlyPage'));
const ShiftBreakPage = lazy(() => import('@/pages/shift/ShiftBreakPage'));
const ShiftEODPage = lazy(() => import('@/pages/shift/ShiftEODPage'));
const ShiftLogoutPage = lazy(() => import('@/pages/shift/ShiftLogoutPage'));
const ShiftHistoryPage = lazy(() => import('@/pages/shift/ShiftHistoryPage'));
const ManagementIntelligenceDashboard = lazy(() => import('@/pages/shift/ManagementIntelligenceDashboard'));
const VendorPortalPage = lazy(() => import('@/pages/public/VendorPortalPage'));
const AbsentLockedPage = lazy(() => import('@/pages/public/AbsentLockedPage'));
const NoAccessPage = lazy(() => import('@/pages/NoAccessPage'));
const SandboxPage = lazy(() => import('@/pages/SandboxPage'));
const PorterPaymentPage = lazyNamed(() => import('@/pages/employee/PorterPaymentPage'), 'PorterPaymentPage');
const TransportPaymentPage = lazyNamed(() => import('@/pages/employee/TransportPaymentPage'), 'TransportPaymentPage');

// Site Visit Module Pages
const NewSiteVisitPage = lazyNamed(() => import('@/pages/site-visit/NewSiteVisitPage'), 'NewSiteVisitPage');
const MySiteVisitsPage = lazyNamed(() => import('@/pages/site-visit/MySiteVisitsPage'), 'MySiteVisitsPage');
const SiteVisitFMDashboard = lazyNamed(() => import('@/pages/site-visit/SiteVisitFMDashboard'), 'SiteVisitFMDashboard');
const SiteVisitDetailPage = lazyNamed(() => import('@/pages/site-visit/SiteVisitDetailPage'), 'SiteVisitDetailPage');
const SiteVisitDailyReportPage = lazyNamed(() => import('@/pages/site-visit/SiteVisitDailyReportPage'), 'SiteVisitDailyReportPage');
const SiteVisitSuccessPage = lazy(() => import('@/pages/site-visit/SiteVisitSuccessPage').then(m => ({ default: m.SiteVisitSuccessPage })));

// Palm Cafe Module Pages
const PalmCafePage = lazy(() => import('@/pages/cafe/PalmCafePage'));
const CafeManagerDashboard = lazy(() => import('@/pages/cafe/CafeManagerDashboard'));

// Core Manager Module
const WeeklyTargetsPage = lazyNamed(() => import('@/pages/core-head/WeeklyTargetsPage'), 'WeeklyTargetsPage');
const WeeklyAchievementsPage = lazyNamed(() => import('@/pages/core-head/WeeklyAchievementsPage'), 'WeeklyAchievementsPage');

// HR & Payroll Module Pages
const HREmployeeMasterPage = lazy(() => import('@/modules/hr-payroll/pages/EmployeeMasterPage'));
const HRPayrollManagementPage = lazy(() => import('@/modules/hr-payroll/pages/PayrollManagementPage'));
const HRSalarySheetPage = lazy(() => import('@/modules/hr-payroll/pages/SalarySheetPage'));
const HREmployeePayrollProfile = lazy(() => import('@/modules/hr-payroll/pages/HREmployeePayrollProfile'));
const HRSalarySheetAccessPage = lazy(() => import('@/modules/hr-payroll/pages/HRSalarySheetAccessPage'));
const HRSalaryApprovalPage = lazy(() => import('@/modules/hr-payroll/pages/SalaryApprovalPage'));
const HRSalaryCalculationPage = lazy(() => import('@/modules/hr-payroll/pages/SalaryCalculationPage'));
const EmployeeMyPayslipsPage = lazy(() => import('@/modules/hr-payroll/pages/EmployeeMyPayslipsPage'));

// Onboarding Module Pages
const OnboardingNewUserPage = lazy(() => import('@/modules/onboarding/pages/NewUserPage'));
const OnboardingCeoAccessPage = lazy(() => import('@/modules/onboarding/pages/CeoAccessPage'));
const OnboardingAdminAccessPage = lazy(() => import('@/modules/onboarding/pages/AdminAccessPage'));
const OnboardingHrAccessPage = lazy(() => import('@/modules/onboarding/pages/HrAccessPage'));
const OnboardingPage = lazy(() => import('@/modules/onboarding/pages/OnboardingPage'));


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// ── Combined ERP: all authenticated roles ──────────────────────────────────────
// Used for routes that every staff member can access regardless of their module.
const ALL_STAFF_ROLES = [
  // IGO Chain
  'employee', 'hr', 'admin', 'ceo', 'accounts', 'gm', 'gmo', 'smo', 'boi',
  'nsm', 'datateam', 'data_team', 'data', 'purchase_head', 'vendor_head',
  'farmmanager', 'auditor', 'director', 'Director', 'bd_data', 'rsh', 'RSH',
  'site_visit_farm_manager', 'cafe_manager', 'palm_cafe_manager',
  // Farmers Factory
  'purchase_manager', 'warehouse_manager', 'qc_manager', 'field_executive',
  'tele_caller', 'driver', 'back_office', 'shift_employee', 'ff_operations_manager',
  'bde',
  // FF New Roles
  'hub_manager', 'l1_manager',
];

// ── Daily Workflow (Day Start / Day Plan / Hourly / EOD): IGO Chain only ───────
// Per refinement plan Milestone 1.1: Sales Team (field_executive, tele_caller, bde)
// and FF Ops Manager (ff_operations_manager) do not use this — their daily
// reporting stays on the FF Shift workflow (/shift/dashboard, /purchase).
// hub_manager and shift_employee are untouched — they were never on this list.
const DAILY_WORKFLOW_EXCLUDED_ROLES = ['field_executive', 'tele_caller', 'bde', 'ff_operations_manager'];
const DAILY_WORKFLOW_ROLES = ALL_STAFF_ROLES.filter((r) => !DAILY_WORKFLOW_EXCLUDED_ROLES.includes(r));

// Operations + management roles (no pure field/driver roles)
const OPS_ROLES = [
  'ceo', 'director', 'Director', 'gm', 'gmo', 'smo', 'boi', 'nsm', 'admin',
  'hr', 'accounts', 'back_office',
  'purchase_manager', 'purchase_head', 'warehouse_manager', 'qc_manager',
  'field_executive', 'tele_caller', 'bde',
  'ff_operations_manager',
  // FF New Roles
  'hub_manager', 'l1_manager', 'shift_employee',
];

// Books of Accounts readers — must match acct_can_read() in ADD_ACCOUNTS_LEDGER_CORE.sql
const BOOKS_READ_ROLES = ['accounts', 'admin', 'ceo', 'director', 'Director', 'auditor', 'Auditor'];

// ff_ops_access: roles eligible for the "loaned" ops-manager dashboard view.
// Mirrors RedirectPage.tsx's FF_OPS_ACCESS_ELIGIBLE_ROLES — keep both in sync.
const FF_OPS_ACCESS_ELIGIBLE_ROLES = new Set(['field_executive', 'bde', 'tele_caller']);

// ff_payment_access: specific individuals (Anusiya/Arun) granted payment
// access including raising new vendor/transport payments — routes this
// bypass applies to.
const FF_PAYMENT_ACCESS_ROUTES = [
  '/my-submitted-payments', '/ff-operations/payment-approvals',
  '/ff/vendor-payment/new', '/ff/transport-payment/new',
  // Warehouse & QC — same flag holders also granted warehouse access
  '/warehouse', '/warehouse/qc', '/warehouse/inventory', '/warehouse/returns', '/warehouse/qc-rejections',
];

const ProtectedRoute = ({
  children,
  allowedRoles
}: {
  children: ReactNode;
  allowedRoles?: string[];
}) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const { data: guardStatus, isLoading: isGuardLoading, isError: isGuardError } = useRouteGuardStatus();


  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Customer sign-ups (role user/customer) are not ERP staff: /no-access is the only page they may see.
  if (user.role?.toLowerCase() === 'customer' && location.pathname !== '/no-access') {
    return <Navigate to="/no-access" replace />;
  }

  // ATTENDANCE LOCK: Only applies to 'employee' role.
  // All other roles (admin, ceo, gm, hr, rsh, director, smo, gmo, boi, accounts, etc.)
  // are NEVER blocked by attendance — they always have full access.
  const role = user.role?.toLowerCase() || '';
  const shouldApplyAttendanceLock = role === 'employee';

  // CRITICAL: Wait for guard status to fully load before evaluating the lock.
  // Without this, DEFAULT_STATUS (hasMorningSelfie=false) causes false lockouts on load.
  if (shouldApplyAttendanceLock && isGuardLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Access Control: Auto-Absent Lockout logic (Selfie-Based) — employees only
  // If there's a network error fetching the status, we fail-open (skip lockout) to avoid false redirects
  if (shouldApplyAttendanceLock) {
    if (isGuardError) {
      console.warn('[ProtectedRoute] Skipping attendance lock due to guard status fetch error. Connectivity blip?', { userId: user?.id });
    } else if (guardStatus) {
      const currentTime = new Date();
      const minutesSinceMidnight = currentTime.getHours() * 60 + currentTime.getMinutes();
      const { hasMorningSelfie, isWeekOff, isShiftUser, isLockRevoked, isManuallyLocked } = guardStatus;

      // Check if manually locked first (blocks access REGARDLESS of time or selfie status)
      if (isManuallyLocked) {
        console.warn('[ProtectedRoute] Redirecting to absent-locked: Manual Lock detected', { userId: user?.id, guardStatus });
        return <Navigate to="/absent-locked" replace />;
      }

      // [TEMPORARILY DISABLED] due to widespread lockout bug

      // [TEMPORARILY DISABLED] due to widespread lockout bug
      // We are investigating why hasMorningSelfie is evaluating to false for users who DO have selfies.
      // Condition: No morning selfie timestamp recorded by 12:30 PM
      /*
      if (!hasMorningSelfie) {
        const LOCKOUT_THRESHOLD = 750; // 12:30 PM in minutes
  
        if (minutesSinceMidnight > LOCKOUT_THRESHOLD) {
          // Skip lockout if it's a shift user (they use flexible shift reporting)
          if (isShiftUser) {
            return <>{children}</>;
          }
  
          // Redirect to lockout UNLESS it's a week off OR the lock has been revoked by admin
          if (!isWeekOff && !isLockRevoked) {
            return <Navigate to="/absent-locked" replace />;
          }
        }
      }
      */
    }
  }

  // ff_ops_access: field_executive members granted ops-manager view without role change
  // Scoped to the same eligible roles as RedirectPage.tsx's FF_OPS_ACCESS_ELIGIBLE_ROLES —
  // without this check, ANY role with the flag set would bypass every route that
  // allows ff_operations_manager (task assignment, payment approvals, etc), not
  // just the intended dashboard-visibility routes.
  const hasFFOpsAccess = (user as any).ff_ops_access === true
    && FF_OPS_ACCESS_ELIGIBLE_ROLES.has((user.role || '').toLowerCase());
  const hasFFPaymentAccess = (user as any).ff_payment_access === true;
  if (allowedRoles && !allowedRoles.some(r => r.toLowerCase() === user.role?.toLowerCase())) {
    // Allow if the user has ff_ops_access AND the route permits ff_operations_manager
    const opsAccessBypass = hasFFOpsAccess && allowedRoles.includes('ff_operations_manager');
    // Allow if the user has ff_payment_access AND this is one of the payment-raising routes
    const paymentAccessBypass = hasFFPaymentAccess && FF_PAYMENT_ACCESS_ROUTES.includes(location.pathname);
    if (!opsAccessBypass && !paymentAccessBypass) {
      return <Navigate to="/redirect" replace />;
    }
  }

  return <>{children}</>;
};

const AppRoutes = () => {
  useLocationTracking(); // Periodic tracking (now safely inside AuthProvider)
  useCafeRealtime(); // Cafe real-time updates (inside QueryClientProvider)
  return (
    <Routes>
      {/* PUBLIC ROUTES - No Authentication Required */}
      <Route path="/vendor/track/:accessToken" element={<VendorPortalPage />} />
      <Route path="/absent-locked" element={<AbsentLockedPage />} />
      <Route path="/no-access" element={<ProtectedRoute><NoAccessPage /></ProtectedRoute>} />

      <Route path="/" element={<Navigate to="/redirect" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/employee-signup" element={<EmployeeSignupPage />} />

      {/* System Routes */}
      <Route path="/redirect" element={<ProtectedRoute><RedirectPage /></ProtectedRoute>} />
      <Route path="/sandbox" element={<ProtectedRoute><SandboxPage /></ProtectedRoute>} />

      {/* Daily Workflow Routes - IGO Chain only (Sales Team + FF Ops Manager excluded, see DAILY_WORKFLOW_ROLES) */}
      <Route path="/employee-dashboard" element={<ProtectedRoute allowedRoles={DAILY_WORKFLOW_ROLES}><EmployeeDashboardPage /></ProtectedRoute>} />
      <Route path="/day-start" element={<ProtectedRoute allowedRoles={DAILY_WORKFLOW_ROLES}><DayStartPage /></ProtectedRoute>} />
      <Route path="/day-plan" element={<ProtectedRoute allowedRoles={DAILY_WORKFLOW_ROLES}><DayPlanPage /></ProtectedRoute>} />
      <Route path="/hourly-report" element={<ProtectedRoute allowedRoles={DAILY_WORKFLOW_ROLES}><HourlyReportPage /></ProtectedRoute>} />
      <Route path="/eod-summary" element={<ProtectedRoute allowedRoles={DAILY_WORKFLOW_ROLES}><EODSummaryPage /></ProtectedRoute>} />
      <Route path="/company-calendar" element={<ProtectedRoute><CompanyCalendarPage /></ProtectedRoute>} />
      <Route path="/my-lop" element={<ProtectedRoute><LOPReversalPage /></ProtectedRoute>} />

      {/* Employee-specific Routes */}
      <Route path="/payment-request" element={<ProtectedRoute allowedRoles={ALL_STAFF_ROLES}><PaymentRequestPage /></ProtectedRoute>} />
      <Route path="/porter-payment" element={<ProtectedRoute allowedRoles={ALL_STAFF_ROLES}><PorterPaymentPage /></ProtectedRoute>} />
      <Route path="/transport-payment" element={<ProtectedRoute allowedRoles={ALL_STAFF_ROLES}><TransportPaymentPage /></ProtectedRoute>} />
      <Route path="/my-requests" element={<ProtectedRoute allowedRoles={ALL_STAFF_ROLES}><MyRequestsPage /></ProtectedRoute>} />
      <Route path="/employee-projects" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'gmo', 'smo']}><EmployeeProjectsPage /></ProtectedRoute>} />
      <Route path="/jv-projects" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'gmo', 'smo']}><EmployeeProjectsPage filters={{ project_type: 'jv' }} /></ProtectedRoute>} />
      <Route path="/leave-request" element={<ProtectedRoute allowedRoles={ALL_STAFF_ROLES}><LeaveRequestPage /></ProtectedRoute>} />
      <Route path="/my-tasks" element={<ProtectedRoute allowedRoles={ALL_STAFF_ROLES}><MyTasksPage /></ProtectedRoute>} />
      <Route path="/my-sops" element={<ProtectedRoute allowedRoles={ALL_STAFF_ROLES}><MySOPsPage /></ProtectedRoute>} />

      {/* Core Manager Module Routes */}
      <Route path="/core-head/targets" element={
        <ProtectedRoute allowedRoles={ALL_STAFF_ROLES}>
          <WeeklyTargetsPage />
        </ProtectedRoute>
      } />
      <Route path="/core-head/achievements" element={
        <ProtectedRoute allowedRoles={ALL_STAFF_ROLES}>
          <WeeklyAchievementsPage />
        </ProtectedRoute>
      } />
      <Route path="/performance-hub" element={
        <ProtectedRoute allowedRoles={['admin', 'ceo', 'hr', 'director', 'Director', 'gm', 'nsm', 'smo', 'gmo', 'auditor']}>
          <WeeklyAchievementsDashboard />
        </ProtectedRoute>
      } />

      {/* Engineering Module Routes */}
      <Route path="/engineer-dashboard" element={<ProtectedRoute allowedRoles={['employee']}><EngineerDashboardPage /></ProtectedRoute>} />
      <Route path="/deal-upload" element={<ProtectedRoute allowedRoles={['employee', 'bd_data']}><DealUploadPage /></ProtectedRoute>} />
      <Route path="/boq-builder" element={<ProtectedRoute allowedRoles={['employee', 'smo']}><BOQBuilderLandingPage /></ProtectedRoute>} />
      <Route path="/engineering/boq/:projectId" element={<ProtectedRoute allowedRoles={['employee', 'smo']}><BOQBuilderPage /></ProtectedRoute>} />
      <Route path="/engineering/boq/:projectId/review" element={<ProtectedRoute allowedRoles={['employee', 'smo']}><BOQReviewPage /></ProtectedRoute>} />
      <Route path="/gmo/new-deals" element={<ProtectedRoute allowedRoles={['gmo', 'admin', 'ceo']}><GMONewDealsPage /></ProtectedRoute>} />
      <Route path="/gmo/project-financials" element={<ProtectedRoute allowedRoles={['gmo', 'admin', 'ceo']}><GMOProjectFinancialsPage /></ProtectedRoute>} />
      <Route path="/smo/boq-approvals" element={<ProtectedRoute allowedRoles={['smo', 'admin']}><BOQApprovalsPage /></ProtectedRoute>} />
      <Route path="/projects/command/:projectId" element={<ProtectedRoute allowedRoles={['admin', 'gmo', 'gm', 'ceo']}><ProjectCommandPage /></ProtectedRoute>} />
      <Route path="/projects/execution/:projectId" element={<ProtectedRoute allowedRoles={['employee', 'smo', 'gmo', 'gm', 'admin', 'ceo', 'purchase_head', 'vendor_head']}><ProjectExecutionDashboard /></ProtectedRoute>} />
      <Route path="/sourcing-dashboard" element={<ProtectedRoute allowedRoles={['employee', 'smo', 'gmo', 'gm', 'admin', 'ceo', 'purchase_head', 'vendor_head']}><SourcingDashboard /></ProtectedRoute>} />

      {/* Finance Routes */}
      <Route path="/project-spending" element={<ProtectedRoute allowedRoles={['admin', 'ceo', 'gm', 'gmo']}><ProjectSpendingPage /></ProtectedRoute>} />

      {/* Purchase & Vendor Sourcing Routes */}
      <Route path="/purchase-dashboard" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'ceo', 'purchase_head']}><PurchaseDashboard /></ProtectedRoute>} />
      <Route path="/purchase/dashboard" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'ceo', 'purchase_head']}><PurchaseDashboard /></ProtectedRoute>} />
      <Route path="/vendor-sourcing/dashboard" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'ceo', 'vendor_head', 'gm']}><VendorSourcingDashboard /></ProtectedRoute>} />
      <Route path="/site-manager/dashboard" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'ceo']}><SiteManagerDashboard /></ProtectedRoute>} />
      <Route path="/farm/dashboard" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'ceo', 'gmo', 'gm', 'smo']}><FarmManagerDashboard /></ProtectedRoute>} />
      <Route path="/inventory" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'ceo', 'gmo', 'gm', 'smo', 'purchase_head', 'vendor_head', 'auditor']}><ProjectInventoryPage /></ProtectedRoute>} />
      <Route path="/procurement-tracking" element={<ProtectedRoute allowedRoles={['admin', 'ceo', 'gmo', 'gm', 'smo', 'purchase_head', 'vendor_head', 'auditor']}><ProjectProcurementPage /></ProtectedRoute>} />


      {/* Universal Routes */}
      <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
      <Route path="/admin/employee-profiles" element={<ProtectedRoute allowedRoles={['admin', 'hr', 'ceo']}><AdminEmployeeProfilePage /></ProtectedRoute>} />
      <Route path="/chat/*" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />

      {/* HR Routes */}
      <Route path="/hr-dashboard" element={<ProtectedRoute allowedRoles={['hr', 'admin', 'ceo']}><HRDashboardPage /></ProtectedRoute>} />
      <Route path="/employee-activity" element={<ProtectedRoute allowedRoles={['hr', 'admin', 'auditor', 'ceo', 'gm', 'boi', 'director', 'Director']}><EmployeeActivityPage /></ProtectedRoute>} />
      <Route path="/selfie-attendance" element={<ProtectedRoute allowedRoles={['hr', 'admin', 'auditor']}><SelfieViewingPage /></ProtectedRoute>} />
      <Route path="/lop-management" element={<ProtectedRoute allowedRoles={['hr', 'auditor']}><LOPManagementPage /></ProtectedRoute>} />
      <Route path="/leave-approvals" element={<ProtectedRoute allowedRoles={['hr', 'admin', 'ceo']}><LeaveApprovalsPage /></ProtectedRoute>} />
      <Route path="/hr/payment-audit" element={<ProtectedRoute allowedRoles={['hr']}><HRPaymentAuditPage /></ProtectedRoute>} />

      {/* HR & Payroll Module Routes */}
      <Route path="/hr/employee-master" element={<ProtectedRoute allowedRoles={['hr', 'admin', 'accounts', 'ceo']}><HREmployeeMasterPage /></ProtectedRoute>} />
      <Route path="/hr/employee-master/:batchId" element={<ProtectedRoute allowedRoles={['hr', 'admin', 'accounts', 'ceo']}><HREmployeeMasterPage /></ProtectedRoute>} />
      <Route path="/hr/payroll" element={<ProtectedRoute allowedRoles={['hr', 'admin', 'accounts', 'ceo']}><HRPayrollManagementPage /></ProtectedRoute>} />
      <Route path="/hr/sheet" element={<ProtectedRoute allowedRoles={['hr', 'admin', 'accounts', 'ceo', 'auditor', 'Auditor', 'director', 'Director']}><HRSalarySheetPage /></ProtectedRoute>} />
      <Route path="/hr/sheet/view" element={<ProtectedRoute allowedRoles={['hr', 'admin', 'accounts', 'ceo']}><HRSalarySheetAccessPage /></ProtectedRoute>} />
      <Route path="/hr/employee-payroll/:profileId" element={<ProtectedRoute allowedRoles={['hr', 'admin', 'accounts', 'ceo', 'auditor']}><HREmployeePayrollProfile /></ProtectedRoute>} />
      <Route path="/hr/approval" element={<ProtectedRoute allowedRoles={['hr', 'admin', 'accounts', 'ceo', 'auditor', 'Auditor', 'director', 'Director']}><HRSalaryApprovalPage /></ProtectedRoute>} />
      <Route path="/hr/salary-calculation" element={<ProtectedRoute allowedRoles={['hr', 'admin', 'accounts', 'ceo']}><HRSalaryCalculationPage /></ProtectedRoute>} />
      <Route path="/my-payslips" element={<ProtectedRoute allowedRoles={ALL_STAFF_ROLES}><EmployeeMyPayslipsPage /></ProtectedRoute>} />

      {/* Onboarding Module Routes */}
      {/* Public route for new employees - no auth required */}
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/onboarding/new-user" element={<ProtectedRoute allowedRoles={['hr', 'admin']}><OnboardingNewUserPage /></ProtectedRoute>} />
      <Route path="/onboarding/hr-access" element={<ProtectedRoute allowedRoles={['hr', 'admin']}><OnboardingHrAccessPage /></ProtectedRoute>} />
      <Route path="/onboarding/ceo-access" element={<ProtectedRoute allowedRoles={['ceo']}><OnboardingCeoAccessPage /></ProtectedRoute>} />
      <Route path="/onboarding/admin-access" element={<ProtectedRoute allowedRoles={['admin']}><OnboardingAdminAccessPage /></ProtectedRoute>} />

      {/* Admin Routes */}
      <Route path="/admin-dashboard" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboardPage /></ProtectedRoute>} />
      <Route path="/admin/attendance-roster" element={<ProtectedRoute allowedRoles={['admin', 'hr', 'ceo', 'auditor']}><AttendanceRosterPage /></ProtectedRoute>} />
      <Route path="/admin-queue" element={<ProtectedRoute allowedRoles={['admin']}><AdminQueuePage /></ProtectedRoute>} />
      <Route path="/admin/project-intake" element={<ProtectedRoute allowedRoles={['admin']}><AdminProjectIntakePage /></ProtectedRoute>} />
      <Route path="/admin-orders" element={<ProtectedRoute allowedRoles={['admin']}><AdminOrdersQueuePage /></ProtectedRoute>} />
      <Route path="/admin/work-orders" element={<ProtectedRoute allowedRoles={['admin']}><AdminWorkOrdersPage /></ProtectedRoute>} />
      <Route path="/admin-payments" element={<ProtectedRoute allowedRoles={['admin']}><AdminPaymentsPage /></ProtectedRoute>} />
      <Route path="/admin/auditor-audit" element={<ProtectedRoute allowedRoles={['admin']}><AdminAuditorPaymentAuditPage /></ProtectedRoute>} />
      <Route path="/admin/procurement" element={<ProtectedRoute allowedRoles={['admin']}><AdminProcurementPage /></ProtectedRoute>} />
      <Route path="/admin/employees" element={<ProtectedRoute allowedRoles={['admin', 'ceo', 'hr']}><EmployeeManagement /></ProtectedRoute>} />
      <Route path="/user-management" element={<ProtectedRoute allowedRoles={['admin']}><UserManagementPage /></ProtectedRoute>} />
      <Route path="/departments" element={<ProtectedRoute allowedRoles={['admin', 'ceo']}><DepartmentManagementPage /></ProtectedRoute>} />
      <Route path="/payment-search" element={<ProtectedRoute allowedRoles={['admin', 'ceo', 'accounts', 'gm', 'director', 'Director']}><PaymentSearchPage /></ProtectedRoute>} />
      <Route path="/projects" element={<ProtectedRoute allowedRoles={['admin', 'ceo', 'gm', 'gmo', 'smo', 'auditor', 'bd_data', 'employee', 'boi']}><ProjectsPage /></ProtectedRoute>} />

      <Route path="/projects/new" element={<ProtectedRoute allowedRoles={['admin', 'ceo', 'bd_data', 'employee', 'boi']}><ProjectFormPage /></ProtectedRoute>} />
      <Route path="/projects/:projectId/edit" element={<ProtectedRoute allowedRoles={['admin', 'ceo', 'bd_data', 'employee', 'boi']}><ProjectFormPage /></ProtectedRoute>} />
      <Route path="/task-assignment" element={<ProtectedRoute allowedRoles={['admin', 'ceo', 'gm', 'boi']}><TaskAssignmentPage /></ProtectedRoute>} />
      <Route path="/role-management" element={<ProtectedRoute allowedRoles={['admin', 'ceo']}><RoleManagementPage /></ProtectedRoute>} />

      <Route path="/announcements" element={<ProtectedRoute allowedRoles={['admin', 'ceo']}><AnnouncementsPage /></ProtectedRoute>} />
      <Route path="/admin-lop" element={<ProtectedRoute allowedRoles={['admin', 'auditor', 'datateam', 'data_team', 'data']}><AdminLOPListPage /></ProtectedRoute>} />
      <Route path="/admin/fix-verticals" element={<ProtectedRoute allowedRoles={['admin', 'ceo']}><FixVerticalsPage /></ProtectedRoute>} />
      <Route path="/admin/escalation-closure" element={<ProtectedRoute allowedRoles={['admin', 'datateam', 'data_team', 'data', 'bd_data', 'employee', 'nsm']}><AdminEscalationClosurePage /></ProtectedRoute>} />
      <Route path="/admin/criticals-audit" element={<ProtectedRoute allowedRoles={['admin', 'datateam', 'data_team', 'data', 'bd_data', 'nsm']}><AdminCriticalsAuditPage /></ProtectedRoute>} />
      <Route path="/admin/week-off-management" element={<ProtectedRoute allowedRoles={['admin', 'ceo', 'hr']}><WeekOffManagementPage /></ProtectedRoute>} />
      <Route path="/admin/sop-management" element={<ProtectedRoute allowedRoles={['admin', 'ceo']}><AdminSOPManagementPage /></ProtectedRoute>} />
      <Route path="/admin/crons" element={<ProtectedRoute allowedRoles={['admin']}><AdminCronJobsPage /></ProtectedRoute>} />
      <Route path="/admin/day-backup" element={<ProtectedRoute allowedRoles={['admin']}><AdminDayBackupPage /></ProtectedRoute>} />
      <Route path="/admin/shift-users" element={<ProtectedRoute allowedRoles={['admin', 'ceo']}><AdminShiftUserManagementPage /></ProtectedRoute>} />
      <Route path="/admin/shift-attendance" element={<ProtectedRoute allowedRoles={['admin', 'ceo']}><AdminShiftAttendancePage /></ProtectedRoute>} />
      <Route path="/admin/lockouts" element={<ProtectedRoute allowedRoles={['admin']}><AdminLockoutManagementPage /></ProtectedRoute>} />
      <Route path="/admin/notification-sounds" element={<ProtectedRoute allowedRoles={['admin']}><AdminNotificationTonesPage /></ProtectedRoute>} />
      <Route path="/admin/rentals/setup" element={<ProtectedRoute allowedRoles={['admin']}><AdminRentalSetupPage /></ProtectedRoute>} />
      <Route path="/admin-rentals" element={<ProtectedRoute allowedRoles={['admin']}><AdminRentalDashboard /></ProtectedRoute>} />
      <Route path="/admin/geofencing" element={<ProtectedRoute allowedRoles={['admin', 'ceo']}><AdminGeofencePage /></ProtectedRoute>} />
      <Route path="/admin/ai-assistant" element={<ProtectedRoute allowedRoles={['admin']}><ERPIntelligencePage /></ProtectedRoute>} />
      <Route path="/admin/ai-command-center" element={<ProtectedRoute allowedRoles={['admin']}><AICommandCenter /></ProtectedRoute>} />
      <Route path="/admin/transport-analysis" element={<ProtectedRoute allowedRoles={['admin', 'ceo']}><TransportAnalysisDashboard /></ProtectedRoute>} />
      {/* CEO Routes */}
      <Route path="/ceo-dashboard" element={<ProtectedRoute allowedRoles={['ceo', 'boi']}><CEODashboardPage /></ProtectedRoute>} />
      <Route path="/ceo-approvals" element={<ProtectedRoute allowedRoles={['ceo', 'gm']}><CEOApprovalsPage /></ProtectedRoute>} />
      <Route path="/ceo/salary-approval" element={<ProtectedRoute allowedRoles={['ceo']}><CEOSalaryApprovalPage /></ProtectedRoute>} />
      <Route path="/ceo/procurement" element={<ProtectedRoute allowedRoles={['ceo']}><CEOProcurementPage /></ProtectedRoute>} />
      <Route path="/ceo-intelligence" element={<ProtectedRoute allowedRoles={['ceo', 'boi']}><CEOIntelligencePage /></ProtectedRoute>} />
      <Route path="/ceo-departments" element={<ProtectedRoute allowedRoles={['ceo', 'boi']}><CEODepartmentPage /></ProtectedRoute>} />
      <Route path="/ceo/work-orders" element={<ProtectedRoute allowedRoles={['ceo']}><CEOWorkOrdersPage /></ProtectedRoute>} />
      <Route path="/ceo/materials" element={<ProtectedRoute allowedRoles={['ceo']}><CEOMaterialsPage /></ProtectedRoute>} />
      <Route path="/ceo/lop-reversals" element={<ProtectedRoute allowedRoles={['ceo']}><CEOLOPReversalsPage /></ProtectedRoute>} />
      <Route path="/ceo/rentals/approvals" element={<ProtectedRoute allowedRoles={['ceo']}><CEORentalApprovalPage /></ProtectedRoute>} />
      <Route path="/ceo/rentals/portfolio" element={<ProtectedRoute allowedRoles={['ceo']}><CEORentalPortfolioPage /></ProtectedRoute>} />

      {/* Accounts Routes */}
      <Route path="/accounts-execution" element={<ProtectedRoute allowedRoles={['accounts', 'admin', 'gm']}><AccountsExecutionPage /></ProtectedRoute>} />
      <Route path="/accounts/salary-execution" element={<ProtectedRoute allowedRoles={['accounts', 'admin', 'ceo']}><AccountsSalaryExecutionPage /></ProtectedRoute>} />
      <Route path="/accounts/salary-sheet" element={<ProtectedRoute allowedRoles={['accounts', 'admin', 'ceo']}><AccountsSalarySheetPage /></ProtectedRoute>} />
      <Route path="/accounts/salary-batches" element={<ProtectedRoute allowedRoles={['accounts', 'admin', 'ceo']}><AccountsSalaryBatchPage /></ProtectedRoute>} />
      <Route path="/accounts/reconciliation" element={<ProtectedRoute allowedRoles={['accounts', 'admin']}><ReconciliationHubPage /></ProtectedRoute>} />

      {/* Petty Cash Governance */}
      <Route path="/accounts/petty-cash/audit" element={
        <ProtectedRoute allowedRoles={['accounts', 'admin', 'auditor', 'director', 'ceo']}>
          <PettyCashAuditPage />
        </ProtectedRoute>
      } />
      <Route path="/accounts/petty-cash/refill" element={
        <ProtectedRoute allowedRoles={['accounts', 'admin', 'director', 'ceo']}>
          <PettyCashRefillPage />
        </ProtectedRoute>
      } />

      {/* Books of Accounts — write: accounts/admin, read: + ceo/director/auditor (also enforced by RLS) */}
      <Route path="/accounts/books/chart" element={<ProtectedRoute allowedRoles={BOOKS_READ_ROLES}><ChartOfAccountsPage /></ProtectedRoute>} />
      <Route path="/accounts/books/vouchers" element={<ProtectedRoute allowedRoles={BOOKS_READ_ROLES}><BooksDayBookPage /></ProtectedRoute>} />
      <Route path="/accounts/books/journal/new" element={<ProtectedRoute allowedRoles={['accounts', 'admin']}><JournalEntryPage /></ProtectedRoute>} />
      <Route path="/accounts/books/ledger" element={<ProtectedRoute allowedRoles={BOOKS_READ_ROLES}><GeneralLedgerPage /></ProtectedRoute>} />
      <Route path="/accounts/books/trial-balance" element={<ProtectedRoute allowedRoles={BOOKS_READ_ROLES}><TrialBalancePage /></ProtectedRoute>} />
      <Route path="/accounts/books/statements" element={<ProtectedRoute allowedRoles={BOOKS_READ_ROLES}><FinancialStatementsPage /></ProtectedRoute>} />
      <Route path="/accounts/books/ageing" element={<ProtectedRoute allowedRoles={BOOKS_READ_ROLES}><AgeingPage /></ProtectedRoute>} />
      <Route path="/accounts/books/settings" element={<ProtectedRoute allowedRoles={BOOKS_READ_ROLES}><BooksSettingsPage /></ProtectedRoute>} />
      <Route path="/accounts/books/parties" element={<ProtectedRoute allowedRoles={BOOKS_READ_ROLES}><PartiesPage /></ProtectedRoute>} />
      <Route path="/accounts/books/party-statements" element={<ProtectedRoute allowedRoles={BOOKS_READ_ROLES}><PartyStatementsPage /></ProtectedRoute>} />
      <Route path="/accounts/books/bank-reconciliation" element={<ProtectedRoute allowedRoles={BOOKS_READ_ROLES}><BankReconciliationPage /></ProtectedRoute>} />
      <Route path="/accounts/fixed-assets" element={<ProtectedRoute allowedRoles={[...BOOKS_READ_ROLES, 'ff_operations_manager', 'gm']}><FixedAssetRegisterPage /></ProtectedRoute>} />
      <Route path="/admin/vehicles" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'logistics']}><VehicleManagementPage /></ProtectedRoute>} />
      <Route path="/admin/crates" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'logistics']}><CrateTrackingPage /></ProtectedRoute>} />
      <Route path="/admin/asset-transfers" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'logistics']}><AssetTransfersPage /></ProtectedRoute>} />
      <Route path="/admin/asset-verification" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'logistics']}><AssetVerificationPage /></ProtectedRoute>} />
      <Route path="/assets/lookup/:id" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'logistics']}><AssetLookupPage /></ProtectedRoute>} />

      <Route path="/accounts/rentals/payments" element={<ProtectedRoute allowedRoles={['accounts', 'admin']}><AccountsRentalPaymentPage /></ProtectedRoute>} />

      {/* GM Routes */}
      <Route path="/gm-dashboard" element={<ProtectedRoute allowedRoles={['gm']}><GMDashboardPage /></ProtectedRoute>} />
      <Route path="/gm-escalations" element={<ProtectedRoute allowedRoles={['gm']}><GMEscalationsPage /></ProtectedRoute>} />
      <Route path="/dashboard/gm/payments" element={<ProtectedRoute allowedRoles={['gm']}><GMPaymentsPage /></ProtectedRoute>} />
      <Route path="/gm/payment-audit" element={<ProtectedRoute allowedRoles={['gm']}><GMPaymentsPage /></ProtectedRoute>} />

      {/* BOI Routes */}
      <Route path="/dashboard/boi" element={<ProtectedRoute allowedRoles={['boi']}><BOIDashboardPage /></ProtectedRoute>} />
      <Route path="/dashboard/boi/tickets" element={<ProtectedRoute allowedRoles={['boi']}><BOIDashboardPage /></ProtectedRoute>} />
      <Route path="/dashboard/boi/escalation-dispatch" element={<ProtectedRoute allowedRoles={['boi']}><BOIDashboardPage /></ProtectedRoute>} />
      <Route path="/dashboard/boi/site-visit-dispatch" element={<ProtectedRoute allowedRoles={['boi']}><BOIDashboardPage /></ProtectedRoute>} />
      <Route path="/dashboard/boi/criticals-dispatch" element={<ProtectedRoute allowedRoles={['boi']}><BOIDashboardPage /></ProtectedRoute>} />
      <Route path="/dashboard/boi/payments" element={<ProtectedRoute allowedRoles={['boi']}><BOIPaymentsPage /></ProtectedRoute>} />
      <Route path="/boi/payment-audit" element={<ProtectedRoute allowedRoles={['boi']}><BOIPaymentsPage /></ProtectedRoute>} />

      {/* GMO Routes */}
      <Route path="/dashboard/gmo" element={<ProtectedRoute allowedRoles={['gmo']}><GMODashboardPage /></ProtectedRoute>} />
      <Route path="/dashboard/gmo/tickets" element={<ProtectedRoute allowedRoles={['gmo']}><GMOTicketsPage /></ProtectedRoute>} />
      <Route path="/gmo/boq-approvals" element={<ProtectedRoute allowedRoles={['gmo', 'admin', 'ceo']}><GMOBOQApprovalsPage /></ProtectedRoute>} />
      <Route path="/dashboard/gmo/projects" element={<ProtectedRoute allowedRoles={['gmo']}><GMOProjectsPage /></ProtectedRoute>} />
      <Route path="/dashboard/gmo/tasks" element={<ProtectedRoute allowedRoles={['gmo']}><GMOTasksPage /></ProtectedRoute>} />
      <Route path="/dashboard/gmo/payments" element={<ProtectedRoute allowedRoles={['gmo']}><GMOPaymentsPage /></ProtectedRoute>} />
      <Route path="/gmo/payment-audit" element={<ProtectedRoute allowedRoles={['gmo']}><GMOPaymentsPage /></ProtectedRoute>} />
      <Route path="/dashboard/gmo/engineering-team" element={<ProtectedRoute allowedRoles={['gmo']}><GMOEngineeringTeamPage /></ProtectedRoute>} />
      <Route path="/gmo-dashboard" element={<Navigate to="/dashboard/gmo" replace />} />

      {/* SMO Routes */}
      <Route path="/dashboard/smo" element={<ProtectedRoute allowedRoles={['smo']}><SMODashboardPage /></ProtectedRoute>} />
      <Route path="/dashboard/smo/tickets" element={<ProtectedRoute allowedRoles={['smo']}><SMOTicketsPage /></ProtectedRoute>} />
      <Route path="/dashboard/smo/projects" element={<ProtectedRoute allowedRoles={['smo']}><SMOProjectsPage /></ProtectedRoute>} />
      <Route path="/dashboard/smo/tasks" element={<ProtectedRoute allowedRoles={['smo']}><SMOTasksPage /></ProtectedRoute>} />
      <Route path="/dashboard/smo/payments" element={<ProtectedRoute allowedRoles={['smo']}><SMOPaymentsPage /></ProtectedRoute>} />
      <Route path="/smo/payment-audit" element={<ProtectedRoute allowedRoles={['smo']}><SMOPaymentsPage /></ProtectedRoute>} />
      <Route path="/smo-dashboard" element={<Navigate to="/dashboard/smo" replace />} />

      {/* Director Routes */}
      <Route path="/dashboard/director" element={<ProtectedRoute allowedRoles={['director', 'Director']}><DirectorDailyWorkflow /></ProtectedRoute>} />
      <Route path="/director/payment-audit" element={<ProtectedRoute allowedRoles={['director', 'Director']}><DirectorDailyWorkflow /></ProtectedRoute>} />
      <Route path="/director/jv-approvals" element={<ProtectedRoute allowedRoles={['director', 'Director']}><JVDirectorDashboard /></ProtectedRoute>} />
      <Route path="/director/salary-audit" element={<ProtectedRoute allowedRoles={['director', 'Director', 'auditor', 'Auditor']}><DirectorSalaryAuditPage /></ProtectedRoute>} />
      <Route path="/director/meal-ordering" element={<ProtectedRoute allowedRoles={['director', 'Director']}><DirectorMealOrderingPage /></ProtectedRoute>} />

      {/* CEO Escalations & Criticals Routes */}
      <Route path="/ceo-escalations" element={<ProtectedRoute allowedRoles={['ceo']}><CEOEscalationsPage /></ProtectedRoute>} />
      <Route path="/admin-escalations" element={<ProtectedRoute allowedRoles={['admin']}><CEOEscalationsPage /></ProtectedRoute>} />

      {/* NSM Routes */}
      <Route path="/nsm-dashboard" element={<ProtectedRoute allowedRoles={['nsm', 'admin', 'boi', 'gm', 'gmo', 'auditor', 'ceo', 'datateam', 'data_team', 'data', 'hr', 'purchase_head', 'vendor_head', 'rsh', 'RSH', 'bd_data', 'employee']}><NSMDashboardPage /></ProtectedRoute>} />


      {/* Auditor Routes - Salary Approval removed; use Salary Audit at /director/salary-audit */}
      <Route path="/auditor-dashboard" element={<ProtectedRoute allowedRoles={['auditor', 'bd_data']}><AuditorDashboardPage /></ProtectedRoute>} />
      <Route path="/auditor/payment-audit" element={<ProtectedRoute allowedRoles={['auditor']}><AuditorPaymentAuditPage /></ProtectedRoute>} />
      <Route path="/auditor/salary-approval" element={<Navigate to="/director/salary-audit" replace />} />


      {/* Data Team Routes */}
      <Route path="/datateam-dashboard" element={<ProtectedRoute allowedRoles={['datateam', 'data_team', 'data']}><DataTeamDashboardPage /></ProtectedRoute>} />
      <Route path="/datateam/wo-audits" element={<ProtectedRoute allowedRoles={['datateam', 'data_team', 'data']}><DataTeamWOAuditPage /></ProtectedRoute>} />
      <Route path="/rsh/rentals" element={<ProtectedRoute allowedRoles={['rsh', 'RSH', 'employee']}><RSHRentalDashboard /></ProtectedRoute>} />
      <Route path="/rentals/payment-history" element={<ProtectedRoute allowedRoles={['rsh', 'RSH', 'admin', 'accounts', 'ceo']}><RentalPaymentHistoryPage /></ProtectedRoute>} />

      {/* Site Visit Module Routes */}
      <Route path="/site-visit-request/new" element={<ProtectedRoute allowedRoles={['rsh', 'RSH', 'smo', 'employee']}><NewSiteVisitPage /></ProtectedRoute>} />
      <Route path="/site-visit-request/my" element={<ProtectedRoute allowedRoles={['rsh', 'RSH', 'smo', 'employee']}><MySiteVisitsPage /></ProtectedRoute>} />
      <Route path="/site-visit-fm-dashboard" element={<ProtectedRoute allowedRoles={['site_visit_farm_manager', 'farmmanager', 'smo', 'employee', 'rsh', 'RSH']}><SiteVisitFMDashboard /></ProtectedRoute>} />
      <Route path="/site-visit-fm-dashboard/:requestId" element={<ProtectedRoute allowedRoles={['site_visit_farm_manager', 'farmmanager', 'smo', 'employee', 'rsh', 'RSH']}><SiteVisitDetailPage /></ProtectedRoute>} />
      <Route path="/site-visit-daily-report/:assignmentId" element={<ProtectedRoute allowedRoles={['site_visit_farm_manager', 'farmmanager', 'smo', 'employee']}><SiteVisitDailyReportPage /></ProtectedRoute>} />
      <Route path="/site-visit-request/success/:id" element={<ProtectedRoute allowedRoles={['rsh', 'RSH', 'smo', 'employee']}><SiteVisitSuccessPage /></ProtectedRoute>} />

      {/* Shift Module Routes — hub_manager, purchase_manager, ff_operations_manager are shift-eligible */}
      <Route path="/shift/dashboard" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'accounts', 'hr', 'smo', 'gmo', 'nsm', 'gm', 'farmmanager', 'site_visit_farm_manager', 'boi', 'datateam', 'data_team', 'data', 'director', 'Director', 'auditor', 'rsh', 'RSH', 'purchase_manager', 'purchase_head', 'hub_manager', 'ff_operations_manager', 'field_executive', 'bde', 'tele_caller', 'driver', 'back_office', 'shift_employee', 'warehouse_manager', 'qc_manager']}><ShiftDashboardPage /></ProtectedRoute>} />
      <Route path="/shift/login" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'accounts', 'hr', 'smo', 'gmo', 'nsm', 'gm', 'farmmanager', 'site_visit_farm_manager', 'boi', 'datateam', 'data_team', 'data', 'director', 'Director', 'auditor', 'rsh', 'RSH', 'purchase_manager', 'purchase_head', 'hub_manager', 'ff_operations_manager', 'field_executive', 'bde', 'tele_caller', 'driver', 'back_office', 'shift_employee', 'warehouse_manager', 'qc_manager']}><ShiftLoginPage /></ProtectedRoute>} />
      <Route path="/shift/hourly" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'accounts', 'hr', 'smo', 'gmo', 'nsm', 'gm', 'farmmanager', 'site_visit_farm_manager', 'boi', 'datateam', 'data_team', 'data', 'director', 'Director', 'auditor', 'rsh', 'RSH', 'purchase_manager', 'purchase_head', 'hub_manager', 'ff_operations_manager', 'field_executive', 'bde', 'tele_caller', 'driver', 'back_office', 'shift_employee', 'warehouse_manager', 'qc_manager']}><ShiftHourlyPage /></ProtectedRoute>} />
      <Route path="/shift/break" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'accounts', 'hr', 'smo', 'gmo', 'nsm', 'gm', 'farmmanager', 'site_visit_farm_manager', 'boi', 'datateam', 'data_team', 'data', 'director', 'Director', 'auditor', 'rsh', 'RSH', 'purchase_manager', 'purchase_head', 'hub_manager', 'ff_operations_manager', 'field_executive', 'bde', 'tele_caller', 'driver', 'back_office', 'shift_employee', 'warehouse_manager', 'qc_manager']}><ShiftBreakPage /></ProtectedRoute>} />
      <Route path="/shift/eod" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'accounts', 'hr', 'smo', 'gmo', 'nsm', 'gm', 'farmmanager', 'boi', 'datateam', 'data_team', 'data', 'director', 'Director', 'auditor', 'rsh', 'RSH', 'purchase_manager', 'purchase_head', 'hub_manager', 'ff_operations_manager', 'field_executive', 'bde', 'tele_caller', 'driver', 'back_office', 'shift_employee', 'warehouse_manager', 'qc_manager']}><ShiftEODPage /></ProtectedRoute>} />
      <Route path="/shift/logout" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'accounts', 'hr', 'smo', 'gmo', 'nsm', 'gm', 'farmmanager', 'boi', 'datateam', 'data_team', 'data', 'director', 'Director', 'auditor', 'rsh', 'RSH', 'purchase_manager', 'purchase_head', 'hub_manager', 'ff_operations_manager', 'field_executive', 'bde', 'tele_caller', 'driver', 'back_office', 'shift_employee', 'warehouse_manager', 'qc_manager']}><ShiftLogoutPage /></ProtectedRoute>} />
      <Route path="/shift/history" element={<ProtectedRoute allowedRoles={['employee', 'admin', 'accounts', 'hr', 'smo', 'gmo', 'nsm', 'gm', 'farmmanager', 'boi', 'datateam', 'data_team', 'data', 'director', 'Director', 'auditor', 'rsh', 'RSH', 'purchase_manager', 'purchase_head', 'hub_manager', 'ff_operations_manager', 'field_executive', 'bde', 'tele_caller', 'driver', 'back_office', 'shift_employee', 'warehouse_manager', 'qc_manager']}><ShiftHistoryPage /></ProtectedRoute>} />

      {/* Rental Module V2 Routes */}
      <Route path="/admin/rental-categories" element={<ProtectedRoute allowedRoles={['admin']}><AdminRentalCategoryPage /></ProtectedRoute>} />
      <Route path="/admin/payment-tags" element={<ProtectedRoute allowedRoles={['admin', 'ceo']}><PaymentTagsPage /></ProtectedRoute>} />
      <Route path="/admin/payment-guardian" element={<ProtectedRoute allowedRoles={['admin', 'ceo']}><PaymentGuardianDashboard /></ProtectedRoute>} />
      <Route path="/rentals/new" element={<ProtectedRoute allowedRoles={['admin', 'rsh', 'RSH', 'employee']}><RentalPropertyFormPage /></ProtectedRoute>} />
      <Route path="/rentals/:id/edit" element={<ProtectedRoute allowedRoles={['admin', 'rsh', 'RSH', 'employee']}><RentalPropertyFormPage /></ProtectedRoute>} />
      <Route path="/rentals/bulk-raise" element={<ProtectedRoute allowedRoles={['rsh', 'RSH', 'employee']}><RentalBulkRaisePage /></ProtectedRoute>} />

      {/* Shared Routes - Open Visibility for all Solver roles */}
      <Route path="/rsh/escalations" element={<ProtectedRoute allowedRoles={['rsh', 'RSH', 'employee', 'ceo', 'admin', 'boi', 'gm']}><RSHEscalationDashboard /></ProtectedRoute>} />
      <Route path="/dashboard/escalations" element={<ProtectedRoute allowedRoles={['boi', 'gmo', 'smo', 'gm', 'admin', 'ceo', 'nsm', 'datateam', 'data_team', 'data', 'bd_data', 'employee']}><UnifiedEscalationsPage /></ProtectedRoute>} />
      <Route path="/dashboard/my-escalations" element={<ProtectedRoute allowedRoles={ALL_STAFF_ROLES}><MyEscalationsPage /></ProtectedRoute>} />
      <Route path="/audit-logs" element={<ProtectedRoute allowedRoles={['admin', 'ceo', 'auditor']}><AuditLogPage /></ProtectedRoute>} />
      <Route path="/attendance-calendar" element={<ProtectedRoute allowedRoles={['admin', 'ceo', 'hr', 'auditor']}><AttendanceCalendarPage /></ProtectedRoute>} />
      <Route path="/employee-directory" element={<ProtectedRoute allowedRoles={['admin', 'hr', 'auditor', 'ceo']}><EmployeeDirectoryPage /></ProtectedRoute>} />
      <Route path="/management/intelligence" element={<ProtectedRoute allowedRoles={['admin', 'ceo', 'hr', 'auditor', 'boi', 'bd_data', 'employee']}><ManagementIntelligenceDashboard /></ProtectedRoute>} />


      {/* Palm Cafe Routes */}
      <Route path="/palm-cafe" element={<ProtectedRoute><PalmCafePage /></ProtectedRoute>} />
      <Route path="/cafe/manager" element={<ProtectedRoute allowedRoles={['palm_cafe_manager']}><CafeManagerDashboard /></ProtectedRoute>} />
      <Route path="/ceo/cafe-analysis" element={<ProtectedRoute allowedRoles={['ceo']}><PalmCafeAnalysis /></ProtectedRoute>} />

      {/* Documentation Route */}
      <Route path="/system-docs" element={<ProtectedRoute allowedRoles={['admin', 'ceo', 'gmo', 'boi', 'smo']}><SystemDocumentationPage /></ProtectedRoute>} />

      {/* ── Farmers Factory ERP Routes ──────────────────────────────────────── */}

      {/* Purchase Module */}
      <Route path="/purchase" element={<ProtectedRoute allowedRoles={OPS_ROLES}><FreshPurchaseDashboard /></ProtectedRoute>} />
      <Route path="/purchase/new" element={<ProtectedRoute allowedRoles={OPS_ROLES}><PurchaseOrderForm /></ProtectedRoute>} />
      <Route path="/purchase/:id/edit" element={<ProtectedRoute allowedRoles={OPS_ROLES}><PurchaseOrderForm /></ProtectedRoute>} />
      <Route path="/purchase/vendors" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'admin', 'ff_operations_manager']}><PurchaseVendorsPage /></ProtectedRoute>} />
      <Route path="/purchase/rate-comparison" element={<ProtectedRoute allowedRoles={OPS_ROLES}><RateComparison /></ProtectedRoute>} />
      <Route path="/purchase/market-rates" element={<ProtectedRoute allowedRoles={OPS_ROLES}><MarketRateEntry /></ProtectedRoute>} />
      <Route path="/purchase/forecast" element={<ProtectedRoute allowedRoles={OPS_ROLES}><DemandForecast /></ProtectedRoute>} />
      <Route path="/purchase/vendor-payments" element={<ProtectedRoute allowedRoles={OPS_ROLES}><VendorPayments /></ProtectedRoute>} />
      <Route path="/purchase/vendor-performance" element={<ProtectedRoute allowedRoles={OPS_ROLES}><VendorPerformance /></ProtectedRoute>} />
      <Route path="/purchase/bill-collection" element={<ProtectedRoute allowedRoles={OPS_ROLES}><BillCollection /></ProtectedRoute>} />

      {/* Warehouse / QC Module — hub_manager + qc_manager + warehouse_manager */}
      <Route path="/warehouse" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'hub_manager', 'qc_manager', 'warehouse_manager']}><WarehouseDashboard /></ProtectedRoute>} />
      <Route path="/warehouse/qc" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'hub_manager', 'qc_manager', 'warehouse_manager']}><QCInspection /></ProtectedRoute>} />
      <Route path="/warehouse/damage" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'hub_manager', 'qc_manager', 'warehouse_manager']}><DamageEntryPage /></ProtectedRoute>} />
      <Route path="/warehouse/eod-wastage" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'hub_manager', 'qc_manager', 'warehouse_manager']}><EODWastageEntryPage /></ProtectedRoute>} />
      <Route path="/warehouse/inventory" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'hub_manager', 'qc_manager', 'warehouse_manager']}><InventoryDashboard /></ProtectedRoute>} />
      <Route path="/warehouse/daily-stock" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'hub_manager']}><DailyStockPage /></ProtectedRoute>} />
      <Route path="/accounts/daily-cash-closing" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'hub_manager']}><DailyCashClosingPage /></ProtectedRoute>} />
      <Route path="/warehouse/returns" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'hub_manager', 'qc_manager', 'warehouse_manager']}><ReturnsDashboard /></ProtectedRoute>} />
      <Route path="/warehouse/qc-rejections" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'hub_manager', 'qc_manager', 'warehouse_manager']}><QCRejections /></ProtectedRoute>} />
      <Route path="/warehouse/po-assignment" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'hub_manager']}><POAssignment /></ProtectedRoute>} />
      <Route path="/warehouse/po-history" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'hub_manager']}><POAssignmentHistory /></ProtectedRoute>} />

      {/* Payment Approval Module */}
      <Route path="/purchase/payment-form" element={<ProtectedRoute allowedRoles={OPS_ROLES}><VendorPaymentForm /></ProtectedRoute>} />
      <Route path="/purchase/payment-approvals" element={<ProtectedRoute allowedRoles={OPS_ROLES}><PaymentApprovalQueue /></ProtectedRoute>} />
      <Route path="/finance/process-payments" element={<ProtectedRoute allowedRoles={OPS_ROLES}><FinancePaymentProcessPage /></ProtectedRoute>} />

      {/* Sales Module */}
      <Route path="/sales" element={<ProtectedRoute allowedRoles={OPS_ROLES}><SalesDashboard /></ProtectedRoute>} />
      <Route path="/sales/new-order" element={<ProtectedRoute allowedRoles={OPS_ROLES}><NewOrder /></ProtectedRoute>} />
      <Route path="/sales/bulk-order" element={<ProtectedRoute allowedRoles={OPS_ROLES}><BulkOrderPage /></ProtectedRoute>} />
      <Route path="/sales/orders" element={<ProtectedRoute allowedRoles={OPS_ROLES}><OrderListPage /></ProtectedRoute>} />
      <Route path="/sales/orders/:id" element={<ProtectedRoute allowedRoles={OPS_ROLES}><OrderDetail /></ProtectedRoute>} />
      <Route path="/sales/customers" element={<ProtectedRoute allowedRoles={OPS_ROLES}><CustomerManagement /></ProtectedRoute>} />
      <Route path="/sales/collections" element={<ProtectedRoute allowedRoles={OPS_ROLES}><CollectionManagement /></ProtectedRoute>} />
      <Route path="/sales/targets" element={<ProtectedRoute allowedRoles={OPS_ROLES}><SalesTargets /></ProtectedRoute>} />
      <Route path="/collections/entry"     element={<ProtectedRoute allowedRoles={['field_executive', 'bde', 'tele_caller', ...OPS_ROLES]}><CollectionEntryPage /></ProtectedRoute>} />
      <Route path="/collections/dashboard" element={<ProtectedRoute allowedRoles={['field_executive', 'bde', 'tele_caller', ...OPS_ROLES]}><CollectionDashboardPage /></ProtectedRoute>} />

      {/* Tele-Caller Module */}
      <Route path="/tele-caller" element={<ProtectedRoute allowedRoles={['tele_caller', 'admin', 'back_office', ...OPS_ROLES]}><TeleCallerDashboard /></ProtectedRoute>} />
      <Route path="/tele-caller/shop/:id" element={<ProtectedRoute allowedRoles={['tele_caller', 'admin', 'back_office', ...OPS_ROLES]}><ShopProfile /></ProtectedRoute>} />
      <Route path="/tele-caller/take-order/:customerId" element={<ProtectedRoute allowedRoles={['tele_caller', 'admin', 'back_office', ...OPS_ROLES]}><TakeOrder /></ProtectedRoute>} />

      {/* Logistics Module */}
      <Route path="/logistics" element={<ProtectedRoute allowedRoles={OPS_ROLES}><LogisticsDashboard /></ProtectedRoute>} />
      <Route path="/logistics/trips/:id" element={<ProtectedRoute allowedRoles={OPS_ROLES}><TripDetail /></ProtectedRoute>} />
      <Route path="/driver" element={<ProtectedRoute allowedRoles={['driver', 'admin', ...OPS_ROLES]}><DriverView /></ProtectedRoute>} />
      <Route path="/logistics/driver" element={<Navigate to="/driver" replace />} />

      {/* Catalog Module */}
      <Route path="/catalog" element={<ProtectedRoute allowedRoles={OPS_ROLES}><ProductCatalogPage /></ProtectedRoute>} />
      <Route path="/catalog/new" element={<ProtectedRoute allowedRoles={OPS_ROLES}><ProductFormPage /></ProtectedRoute>} />
      <Route path="/catalog/:id/edit" element={<ProtectedRoute allowedRoles={OPS_ROLES}><ProductFormPage /></ProtectedRoute>} />

      {/* Reports Module */}
      <Route path="/reports" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'overview']}><ReportsDashboard /></ProtectedRoute>} />
      <Route path="/reports/pl" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'overview']}><PLReport /></ProtectedRoute>} />
      <Route path="/reports/balance-sheet" element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'overview']}><BalanceSheetReport /></ProtectedRoute>} />
      <Route path="/reports/custom" element={<ProtectedRoute allowedRoles={OPS_ROLES}><CustomReportBuilder /></ProtectedRoute>} />
      <Route path="/reports/purchase"    element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'overview']}><PurchaseReportPage /></ProtectedRoute>} />
      <Route path="/reports/sales"       element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'overview']}><DailySalesReportPage /></ProtectedRoute>} />
      <Route path="/reports/inventory"   element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'overview']}><InventoryReportPage /></ProtectedRoute>} />
      <Route path="/reports/delivery"    element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'overview']}><DeliveryReportPage /></ProtectedRoute>} />
      <Route path="/reports/attendance"  element={<ProtectedRoute allowedRoles={OPS_ROLES}><AttendanceReportPage /></ProtectedRoute>} />
      <Route path="/reports/collection"  element={<ProtectedRoute allowedRoles={[...OPS_ROLES, 'overview']}><CashCollectionReportPage /></ProtectedRoute>} />

      {/* Hub Management */}
      <Route path="/admin/hubs" element={<ProtectedRoute allowedRoles={['admin', 'ceo', 'ff_operations_manager']}><HubManagementPage /></ProtectedRoute>} />
      <Route path="/admin/hubs/:hubId" element={<ProtectedRoute allowedRoles={['admin', 'ceo', 'ff_operations_manager']}><HubManagementPage /></ProtectedRoute>} />
      <Route path="/admin/qc-overview" element={<ProtectedRoute allowedRoles={['admin', 'ceo']}><AdminQCOverviewPage /></ProtectedRoute>} />

      {/* FF Operations Home */}
      <Route path="/ff-operations" element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'purchase_manager', 'purchase_head', 'ff_operations_manager']}><FFOperationsHomePage /></ProtectedRoute>} />
      <Route path="/ff-operations/items" element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'purchase_manager', 'purchase_head', 'ff_operations_manager']}><ItemsPage /></ProtectedRoute>} />
      <Route path="/ff-operations/inventory" element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'ff_operations_manager', 'gm', 'hub_manager']}><SmartInventoryPage /></ProtectedRoute>} />
      <Route path="/ff-operations/gm-dashboard" element={<ProtectedRoute allowedRoles={['admin', 'ff_operations_manager', 'gm', 'ceo', 'l1_manager']}><GMOperationsDashboard /></ProtectedRoute>} />
      <Route path="/ff-operations/day-kpis" element={<ProtectedRoute allowedRoles={['admin', 'ff_operations_manager', 'gm', 'ceo']}><DayKPIsPage /></ProtectedRoute>} />
      <Route path="/ff-operations/eod-po-engine" element={<ProtectedRoute allowedRoles={['admin', 'ff_operations_manager', 'gm', 'purchase_manager', 'purchase_head', 'field_executive', 'bde', 'tele_caller', 'back_office', 'hub_manager']}><EODPOEngine /></ProtectedRoute>} />

      {/* ── FF Phase 3 Pages ── */}
      {/* Sales Team */}
      <Route path="/sales/app-orders" element={<ProtectedRoute allowedRoles={['admin','field_executive','bde','tele_caller','ff_operations_manager','gm','ceo','l1_manager']}><AppOrdersDashboard /></ProtectedRoute>} />
      <Route path="/sales/task-today" element={<ProtectedRoute allowedRoles={['field_executive','bde','tele_caller','admin']}><TaskToday /></ProtectedRoute>} />
      {/* FF Ops Manager */}
      <Route path="/ff-operations/task-assign"        element={<ProtectedRoute allowedRoles={['ff_operations_manager','admin']}><TaskAssign /></ProtectedRoute>} />
      <Route path="/ff-operations/payment-approvals"  element={<ProtectedRoute allowedRoles={['ff_operations_manager','admin']}><FFPaymentApprovals /></ProtectedRoute>} />
      <Route path="/ff-operations/vendor-bulk-payment" element={<ProtectedRoute allowedRoles={['ff_operations_manager','admin']}><VendorBulkPaymentPage /></ProtectedRoute>} />
      {/* Phase 4: Payment submission forms */}
      {/* hub_manager and shift_employee (purchase executive) deliberately excluded here --
          they may only raise Transport Payments manually; their vendor payments come
          exclusively from BuyPage.tsx's automatic creation on a completed buy, not this form. */}
      <Route path="/ff/vendor-payment/new"    element={<ProtectedRoute allowedRoles={['purchase_manager','purchase_head','ff_operations_manager','admin']}><FFVendorPaymentForm /></ProtectedRoute>} />
      <Route path="/ff/transport-payment/new" element={<ProtectedRoute allowedRoles={['hub_manager','shift_employee','purchase_manager','purchase_head','ff_operations_manager','admin']}><FFTransportPaymentForm /></ProtectedRoute>} />
      {/* Phase 5: FF Payments Report */}
      <Route path="/reports/ff-payments" element={<ProtectedRoute allowedRoles={['admin','ceo','gm','l1_manager','auditor','ff_operations_manager','accounts','overview']}><FFPaymentsReport /></ProtectedRoute>} />
      {/* Management Overview — view-only login (role 'overview'); admin may preview it.      Read-only by construction: the page only runs SELECTs. */}
      <Route path="/overview" element={<ProtectedRoute allowedRoles={['overview', 'admin']}><OverviewPage /></ProtectedRoute>} />
      <Route path="/overview/:tab" element={<ProtectedRoute allowedRoles={['overview', 'admin']}><OverviewPage /></ProtectedRoute>} />
      {/* GM FF payments (shared component, role-aware) */}
      <Route path="/gm/ff-payments"           element={<ProtectedRoute allowedRoles={['gm','admin']}><FFPaymentApprovals /></ProtectedRoute>} />
      <Route path="/gm/ff-transport-payments" element={<ProtectedRoute allowedRoles={['gm','admin']}><FFPaymentApprovals /></ProtectedRoute>} />
      {/* L1 Manager */}
      <Route path="/l1/payments"           element={<ProtectedRoute allowedRoles={['l1_manager','admin']}><FFPaymentApprovals /></ProtectedRoute>} />
      <Route path="/l1/transport-payments" element={<ProtectedRoute allowedRoles={['l1_manager','admin']}><FFPaymentApprovals /></ProtectedRoute>} />
      {/* Auditor — retired from the active approval chain (see FFPaymentApprovals.tsx),
          routes kept only so a stray auditor-role account doesn't 404 */}
      <Route path="/auditor/ff-payments"           element={<ProtectedRoute allowedRoles={['auditor','admin']}><FFPaymentApprovals /></ProtectedRoute>} />
      <Route path="/auditor/ff-transport-payments" element={<ProtectedRoute allowedRoles={['auditor','admin']}><FFPaymentApprovals /></ProtectedRoute>} />
      {/* Admin — its own stage in the chain (Manager -> L1 -> Admin -> CEO -> Accounts) */}
      <Route path="/admin/ff-payments"           element={<ProtectedRoute allowedRoles={['admin']}><FFPaymentApprovals /></ProtectedRoute>} />
      <Route path="/admin/ff-transport-payments" element={<ProtectedRoute allowedRoles={['admin']}><FFPaymentApprovals /></ProtectedRoute>} />
      {/* CEO */}
      <Route path="/ceo/ff-overview"           element={<ProtectedRoute allowedRoles={['ceo','admin']}><CEOFFOverview /></ProtectedRoute>} />
      <Route path="/ceo/ff-payments"           element={<ProtectedRoute allowedRoles={['ceo','admin']}><FFPaymentApprovals /></ProtectedRoute>} />
      <Route path="/ceo/ff-transport-payments" element={<ProtectedRoute allowedRoles={['ceo','admin']}><FFPaymentApprovals /></ProtectedRoute>} />
      {/* Accounts — FF payments (mark-as-paid) */}
      <Route path="/accounts/ff-payments"           element={<ProtectedRoute allowedRoles={['accounts','admin']}><FFPaymentApprovals /></ProtectedRoute>} />
      <Route path="/accounts/ff-transport-payments" element={<ProtectedRoute allowedRoles={['accounts','admin']}><FFPaymentApprovals /></ProtectedRoute>} />
      <Route path="/accounts/execution-desk"        element={<ProtectedRoute allowedRoles={['accounts','admin']}><ExecutionDeskPage /></ProtectedRoute>} />
      <Route path="/accounts/batch-history"         element={<ProtectedRoute allowedRoles={['accounts','admin','ceo']}><BatchHistoryPage /></ProtectedRoute>} />
      {/* My Submitted Payments — raisers only (hub_manager, shift_employee, purchase_manager/head) */}
      <Route path="/my-submitted-payments" element={<ProtectedRoute allowedRoles={['hub_manager','shift_employee','purchase_manager','purchase_head','admin']}><MySubmittedPayments /></ProtectedRoute>} />

      {/* FF Operations — Purchase sub-pages */}
      <Route path="/purchase/expenses"           element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'purchase_manager', 'purchase_head', 'ff_operations_manager']}><PurchaseExpensesPage /></ProtectedRoute>} />
      <Route path="/purchase/recurring-expenses" element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'purchase_manager', 'purchase_head', 'ff_operations_manager']}><RecurringExpensesPage /></ProtectedRoute>} />
      <Route path="/purchase/orders"             element={<ProtectedRoute allowedRoles={OPS_ROLES}><PurchaseOrdersPage /></ProtectedRoute>} />
      <Route path="/purchase/auto-po"            element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'purchase_manager', 'purchase_head', 'ff_operations_manager', 'field_executive', 'bde', 'tele_caller', 'hub_manager', 'gm', 'ceo']}><AutoPOPage /></ProtectedRoute>} />
      <Route path="/purchase/bills"              element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'purchase_manager', 'purchase_head', 'ff_operations_manager']}><PurchaseBillsPage /></ProtectedRoute>} />
      <Route path="/accounts/books/purchase-invoices" element={<ProtectedRoute allowedRoles={BOOKS_READ_ROLES}><PurchaseInvoicesPage /></ProtectedRoute>} />
      <Route path="/purchase/auto-bill"          element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'purchase_manager', 'purchase_head', 'ff_operations_manager']}><AutoBillPage /></ProtectedRoute>} />
      <Route path="/purchase/buy"               element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'purchase_manager', 'purchase_head', 'shift_employee', 'ff_operations_manager']}><BuyPage /></ProtectedRoute>} />
      <Route path="/purchase/po-buys"            element={<ProtectedRoute allowedRoles={['admin']}><POBuysReview /></ProtectedRoute>} />
      <Route path="/purchase/recurring-bills"    element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'purchase_manager', 'purchase_head', 'ff_operations_manager']}><RecurringBillsPage /></ProtectedRoute>} />
      <Route path="/purchase/payments-made"      element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'purchase_manager', 'purchase_head', 'ff_operations_manager']}><PaymentsMadePage /></ProtectedRoute>} />
      <Route path="/purchase/vendor-credits"     element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'purchase_manager', 'purchase_head', 'ff_operations_manager']}><VendorCreditsPage /></ProtectedRoute>} />
      <Route path="/purchase/debit-notes"        element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'purchase_manager', 'purchase_head', 'ff_operations_manager', 'accounts']}><DebitNotesPage /></ProtectedRoute>} />

      {/* FF Operations — Sales sub-pages — tele_caller + hub_manager + ceo + gm added */}
      <Route path="/sales/customers"             element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'field_executive', 'bde', 'tele_caller', 'ff_operations_manager', 'gm', 'ceo', 'hub_manager']}><SalesCustomersPage /></ProtectedRoute>} />
      <Route path="/sales/orders"                element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'field_executive', 'bde', 'tele_caller', 'ff_operations_manager', 'gm', 'ceo', 'hub_manager']}><SalesOrdersPage /></ProtectedRoute>} />
      <Route path="/sales/invoices"              element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'field_executive', 'bde', 'tele_caller', 'ff_operations_manager', 'gm', 'ceo', 'hub_manager', 'accounts']}><SalesInvoicesPage /></ProtectedRoute>} />
      <Route path="/sales/recurring-invoices"    element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'field_executive', 'bde', 'tele_caller', 'ff_operations_manager', 'gm', 'ceo']}><RecurringInvoicesPage /></ProtectedRoute>} />
      <Route path="/sales/delivery-challans"     element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'field_executive', 'bde', 'tele_caller', 'ff_operations_manager', 'gm', 'ceo']}><DeliveryChallansPage /></ProtectedRoute>} />
      <Route path="/sales/payments-received"     element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'field_executive', 'bde', 'tele_caller', 'ff_operations_manager', 'gm', 'ceo', 'accounts']}><PaymentsReceivedPage /></ProtectedRoute>} />
      <Route path="/sales/credit-notes"          element={<ProtectedRoute allowedRoles={['admin', 'back_office', 'field_executive', 'bde', 'tele_caller', 'ff_operations_manager', 'gm', 'ceo', 'accounts']}><CreditNotesPage /></ProtectedRoute>} />

      {/* Finance Module (FF ERP) */}
      <Route path="/finance" element={<ProtectedRoute allowedRoles={OPS_ROLES}><FinanceDashboard /></ProtectedRoute>} />

      {/* Obsolete routes - redirect to appropriate pages */}
      <Route path="/solver-dashboard" element={<Navigate to="/redirect" replace />} />
      <Route path="/civil-projects" element={<Navigate to="/projects" replace />} />
      <Route path="/agri-projects" element={<Navigate to="/projects" replace />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => {
  useEffect(() => {
    preloadCustomTones();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <TooltipProvider>
          <BrowserRouter>
            <AlertProvider>
              <ChatOverlayProvider>
                <Toaster />
                <Sonner />
                <Routes>
                  {/* Customer Portal: fully public, no AppLayout, no sidebar */}
                  <Route path="/customer/*" element={
                    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-green-600" /></div>}>
                      <CustomerPortal />
                    </Suspense>
                  } />

                  {/* All other routes: wrapped in AppLayout (sidebar + header) */}
                  <Route path="*" element={
                    <>
                      <CafeLiveFlash />
                      <AppLayout>
                        <Suspense fallback={
                          <div className="min-h-screen flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                          </div>
                        }>
                          <AppRoutes />
                        </Suspense>
                      </AppLayout>
                    </>
                  } />
                </Routes>
              </ChatOverlayProvider>
              <SpeedInsights />
            </AlertProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ErrorBoundary>
    </QueryClientProvider>
  );
};

export default App;
