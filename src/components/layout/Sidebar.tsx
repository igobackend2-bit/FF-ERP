import { useAuth } from '@/contexts/AuthContext';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useDayStart } from '@/hooks/useDayStart';
import { useIsCoreHead } from '@/hooks/useIsCoreHead';
import { useFFPaymentCount } from '@/hooks/useFFPaymentCount';
import { format } from 'date-fns';
import { ThemeSelector } from '@/components/ThemeSelector';
import {
  Clock,
  ClipboardList,
  Timer,
  FileText,
  CreditCard,
  History,
  Users,
  CheckSquare,
  Plus,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  BarChart3,
  Banknote,
  FileSearch,
  Search,
  Calendar,
  FolderKanban,
  AlertTriangle,
  User,
  UserPlus,
  MessageSquarePlus,
  Camera,
  PhoneCall,
  LayoutDashboard,
  Shield,
  Briefcase,
  Upload,
  Inbox,
  ClipboardCheck,
  Truck,
  Package,
  Activity,
  Settings,
  Lock,
  Volume2,
  ShieldCheck,
  MapPin,
  Layers,
  Wallet,
  FileBarChart,
  RotateCcw,
  Bot,
  Building2,
  PieChart,
  MessageSquare,
  ShieldAlert,
  Home,
  X,
  Coffee,
  Zap,
  ChefHat,
  Handshake,
  PlusCircle,
  BookOpen,
  Database,
  ShoppingCart,
  Warehouse,
  PackageCheck,
  TrendingUp,
  Store,
  Star,
  Boxes,
  Target,
  UserCog,
  MessageSquarePlus as Feedback,
  CheckCircle2,
  Calculator,
  Scale,
  Landmark,
  ListTree,
  NotebookPen,
  Hourglass,
  DollarSign,
  RefreshCw,
  ArrowRightLeft,
  Sunrise,
} from 'lucide-react';

export interface NavChild {
  label: string;
  path: string;
  action?: boolean; // shows a + button
}

export interface NavItem {
  icon: React.ElementType;
  label: string;
  path: string;
  children?: NavChild[];
  badgeKey?: string; // key into pendingCounts map to show a red badge
}

export interface NavGroup {
  title: string;
  icon: React.ElementType;
  roles: string[];
  items: NavItem[];
  departments?: string[];
  excludeDepartments?: string[];
  defaultOpen?: boolean; // mobile-only: whether this group starts expanded
}

// Single source of truth for the app's navigation — both the desktop
// Sidebar and MobileSidebar render from this same array so they can't
// drift apart the way they had (22 groups missing from mobile, including
// the entire FF Payment Pipeline, before this was unified).
export const navigationConfig: NavGroup[] = [
  // ── Daily Workflow (ALL roles except shift/purchase exec) ───────────────────
  {
    title: 'Daily Workflow',
    icon: Clock,
    roles: [
      'employee', 'director', 'Director', 'vendor_head',
      'nsm', 'datateam', 'data_team', 'data', 'boi', 'gmo', 'smo',
      'farmmanager', 'bd_data', 'rsh', 'RSH', 'site_visit_farm_manager',
      'cafe_manager', 'palm_cafe_manager',
      'back_office', 'driver',
      // gm, l1_manager, auditor intentionally excluded — payment-only roles
      // accounts intentionally excluded — approve-only via FF Payments below
      // purchase_manager, purchase_head, shift_employee → trimmed section below
      // hub_manager → trimmed section below
      // field_executive, tele_caller, bde, ff_operations_manager excluded —
      // matches DAILY_WORKFLOW_EXCLUDED_ROLES in App.tsx (routes already bounce them)
    ],
    items: [
      { icon: Home,          label: 'My Dashboard',          path: '/employee-dashboard' },
      { icon: Clock,         label: 'Login',                  path: '/day-start' },
      { icon: Timer,         label: 'Hourly Plan & Report',   path: '/hourly-report' },
      { icon: ClipboardList, label: 'Day Plan',               path: '/day-plan' },
      { icon: FileText,      label: 'EOD Summary',            path: '/eod-summary' },
      { icon: Calendar,      label: 'Company Calendar',       path: '/company-calendar' },
      { icon: CheckSquare,   label: 'My Tasks',               path: '/my-tasks' },
      { icon: AlertTriangle, label: 'My LOP / Discipline',    path: '/my-lop' },
      { icon: AlertTriangle, label: 'My Escalations',         path: '/dashboard/my-escalations' },
      { icon: Calendar,      label: 'Leave Request',          path: '/leave-request' },
      { icon: CreditCard,    label: 'Payment Request',        path: '/payment-request' },
      { icon: FileText,      label: 'My Payslip',             path: '/my-payslips' },
      { icon: BookOpen,      label: 'My SOPs',                path: '/my-sops' },
      { icon: History,       label: 'My Requests',            path: '/my-requests' },
      { icon: Coffee,        label: 'PALM CAFE',              path: '/palm-cafe' },
      { icon: MessageSquare, label: 'Chat',                   path: '/chat' },
    ],
  },

  // ── Daily Workflow (Purchase Exec / Shift Employee — trimmed) ────────────────
  {
    title: 'Daily Workflow',
    icon: Clock,
    roles: ['purchase_manager', 'purchase_head', 'shift_employee', 'hub_manager'],
    items: [
      { icon: FileText,      label: 'EOD Summary',         path: '/eod-summary' },
      { icon: Calendar,      label: 'Company Calendar',    path: '/company-calendar' },
      { icon: AlertTriangle, label: 'My LOP / Discipline', path: '/my-lop' },
      { icon: AlertTriangle, label: 'My Escalations',      path: '/dashboard/my-escalations' },
      { icon: Calendar,      label: 'Leave Request',       path: '/leave-request' },
      { icon: FileText,      label: 'My Payslip',          path: '/my-payslips' },
      { icon: History,       label: 'My Requests',         path: '/my-requests' },
    ],
  },

  // ── PALM CAFE Manager ───────────────────────────────────────────────────────
  {
    title: 'PALM CAFE',
    icon: ChefHat,
    roles: ['palm_cafe_manager', 'cafe_manager'],
    items: [
      { icon: LayoutDashboard, label: 'Order Receiving', path: '/cafe/manager' },
    ],
  },

  // ── Director Board ───────────────────────────────────────────────────────────
  {
    title: 'Director Board',
    icon: Shield,
    roles: ['director', 'Director'],
    items: [
      { icon: LayoutDashboard, label: 'Audit Dashboard',       path: '/dashboard/director' },
      { icon: Handshake,       label: 'JV Audit Queue',        path: '/director/jv-approvals' },
      { icon: Activity,        label: 'Employee Activity',     path: '/employee-activity' },
      { icon: CheckSquare,     label: 'Salary Audit (Upload)', path: '/director/salary-audit' },
      { icon: Banknote,        label: 'Salary Batches',        path: '/hr/sheet' },
      { icon: Search,          label: 'Payment Search',        path: '/payment-search' },
      { icon: Coffee,          label: 'Meal Ordering',         path: '/director/meal-ordering' },
    ],
  },

  // ── Engineering Employee ────────────────────────────────────────────────────
  {
    title: 'Work',
    icon: Briefcase,
    roles: ['employee'],
    departments: ['engineering'],
    items: [
      { icon: LayoutDashboard, label: 'Dashboard',          path: '/engineer-dashboard' },
      { icon: FolderKanban,    label: 'My Projects',        path: '/employee-projects' },
      { icon: PlusCircle,      label: 'Payment Request',    path: '/payment-request' },
      { icon: ShieldCheck,     label: 'Escalation Audit',   path: '/admin/escalation-closure' },
      { icon: AlertTriangle,   label: 'All Tickets',        path: '/dashboard/escalations' },
    ],
  },
  {
    title: 'Work',
    icon: Briefcase,
    roles: ['employee'],
    departments: ['jv_engineering', 'JV Engineering'],
    items: [
      { icon: LayoutDashboard, label: 'Dashboard',    path: '/engineer-dashboard' },
      { icon: Handshake,       label: 'JV Projects',  path: '/jv-projects' },
      { icon: AlertTriangle,   label: 'All Tickets',  path: '/dashboard/escalations' },
    ],
  },
  {
    title: 'Work',
    icon: Briefcase,
    roles: ['employee'],
    departments: ['business development', 'bd'],
    items: [
      { icon: Plus,          label: 'Create Project',     path: '/projects/new' },
      { icon: FolderKanban,  label: 'Project History',    path: '/projects' },
      { icon: ShieldCheck,   label: 'Escalation Audit',   path: '/admin/escalation-closure' },
      { icon: AlertTriangle, label: 'All Tickets',        path: '/dashboard/escalations' },
    ],
  },
  {
    title: 'BD Data Work',
    icon: Briefcase,
    roles: ['bd_data'],
    items: [
      { icon: Upload,        label: 'Upload Project',     path: '/deal-upload' },
      { icon: FolderKanban,  label: 'Project History',    path: '/projects' },
      { icon: AlertTriangle, label: 'Escalation Closure', path: '/admin/escalation-closure' },
      { icon: AlertTriangle, label: 'Criticals Audit',    path: '/admin/criticals-audit' },
    ],
  },

  // ── NSM ─────────────────────────────────────────────────────────────────────
  {
    title: 'Command Center',
    icon: LayoutDashboard,
    roles: ['nsm'],
    items: [
      { icon: BarChart3,     label: 'NSM Dashboard',      path: '/nsm-dashboard' },
      { icon: ShieldCheck,   label: 'Escalation Audit',   path: '/admin/escalation-closure' },
      { icon: Zap,           label: 'Criticals Audit',    path: '/admin/criticals-audit' },
      { icon: AlertTriangle, label: 'All Tickets',        path: '/dashboard/escalations' },
    ],
  },

  // ── Data Team ───────────────────────────────────────────────────────────────
  {
    title: 'Command Center',
    icon: LayoutDashboard,
    roles: ['datateam', 'data_team', 'data'],
    items: [
      { icon: BarChart3,     label: 'Create Critical',    path: '/datateam-dashboard' },
      { icon: FileSearch,    label: 'WO Audits',          path: '/datateam/wo-audits' },
      { icon: AlertTriangle, label: 'All Tickets',        path: '/dashboard/escalations' },
      { icon: AlertTriangle, label: 'Escalation Closure', path: '/admin/escalation-closure' },
      { icon: AlertTriangle, label: 'Criticals Audit',    path: '/admin/criticals-audit' },
    ],
  },

  // ── BOI ─────────────────────────────────────────────────────────────────────
  {
    title: 'Command Center',
    icon: LayoutDashboard,
    roles: ['boi'],
    items: [
      { icon: BarChart3,    label: 'BOI Dashboard',  path: '/dashboard/boi' },
      { icon: CreditCard,   label: 'Payment Audit',  path: '/dashboard/boi/payments' },
      { icon: FolderKanban, label: 'Projects',       path: '/projects' },
    ],
  },

  // ── GMO ─────────────────────────────────────────────────────────────────────
  {
    title: 'Command Center',
    icon: LayoutDashboard,
    roles: ['gmo'],
    items: [
      { icon: BarChart3,     label: 'Dashboard',          path: '/dashboard/gmo' },
      { icon: Inbox,         label: 'New Deals',           path: '/gmo/new-deals' },
      { icon: Truck,         label: 'Project Overview',    path: '/sourcing-dashboard' },
      { icon: CheckSquare,   label: 'Project Approvals',   path: '/gmo/boq-approvals' },
      { icon: FolderKanban,  label: 'Projects',            path: '/dashboard/gmo/projects' },
      { icon: CreditCard,    label: 'Payment Audit',       path: '/dashboard/gmo/payments' },
      { icon: Wallet,        label: 'Project Financials',  path: '/gmo/project-financials' },
      { icon: Activity,      label: 'Engineering Team',    path: '/dashboard/gmo/engineering-team' },
      { icon: PieChart,      label: 'Project Spending',    path: '/project-spending' },
      { icon: AlertTriangle, label: 'My Escalations',      path: '/dashboard/my-escalations' },
    ],
  },

  // ── SMO ─────────────────────────────────────────────────────────────────────
  {
    title: 'Command Center',
    icon: LayoutDashboard,
    roles: ['smo'],
    excludeDepartments: ['rental sourcing', 'site visit', 'jv_engineering', 'JV Engineering'],
    items: [
      { icon: BarChart3,     label: 'Dashboard',      path: '/dashboard/smo' },
      { icon: CreditCard,    label: 'Payment Audit',  path: '/dashboard/smo/payments' },
      { icon: AlertTriangle, label: 'All Tickets',    path: '/dashboard/smo/tickets' },
    ],
  },
  {
    title: 'Command Center',
    icon: LayoutDashboard,
    roles: ['smo'],
    departments: ['jv_engineering', 'JV Engineering'],
    items: [
      { icon: BarChart3,     label: 'Dashboard',       path: '/dashboard/smo' },
      { icon: CreditCard,    label: 'Payment Audit',   path: '/dashboard/smo/payments' },
      { icon: AlertTriangle, label: 'My Escalations',  path: '/dashboard/my-escalations' },
    ],
  },
  {
    title: 'Execution',
    icon: Truck,
    roles: ['smo'],
    excludeDepartments: ['rental sourcing', 'site visit', 'jv_engineering', 'JV Engineering'],
    items: [
      { icon: ClipboardCheck, label: 'Project Approvals',       path: '/smo/boq-approvals' },
      { icon: Truck,          label: 'Project Overview',        path: '/sourcing-dashboard' },
      { icon: FolderKanban,   label: 'Project Execution (All)', path: '/employee-projects' },
      { icon: FolderKanban,   label: 'Projects (Manager)',      path: '/dashboard/smo/projects' },
    ],
  },
  {
    title: 'Execution',
    icon: Truck,
    roles: ['smo'],
    departments: ['jv_engineering', 'JV Engineering'],
    items: [
      { icon: FolderKanban, label: 'Project Execution (All)', path: '/employee-projects' },
    ],
  },

  // ── HR ──────────────────────────────────────────────────────────────────────
  {
    title: 'HR Home',
    icon: LayoutDashboard,
    roles: ['hr'],
    items: [
      { icon: LayoutDashboard, label: 'HR Dashboard',  path: '/hr-dashboard' },
      { icon: History,         label: 'My Requests',   path: '/my-requests' },
      { icon: Coffee,          label: 'PALM CAFE',     path: '/palm-cafe' },
      { icon: MessageSquare,   label: 'Chat',          path: '/chat' },
    ],
  },
  {
    title: 'Attendance & Activity',
    icon: Activity,
    roles: ['hr'],
    items: [
      { icon: Activity,      label: 'Employee Activity',   path: '/employee-activity' },
      { icon: Camera,        label: 'Selfie Attendance',   path: '/selfie-attendance' },
      { icon: ClipboardList, label: 'Attendance Roster',  path: '/admin/attendance-roster' },
      { icon: Calendar,      label: 'Attendance Calendar', path: '/attendance-calendar' },
    ],
  },
  {
    title: 'Leave & LOP',
    icon: Calendar,
    roles: ['hr'],
    items: [
      { icon: Calendar,      label: 'Leave Approvals',         path: '/leave-approvals' },
      { icon: AlertTriangle, label: 'LOP Management',          path: '/lop-management' },
      { icon: Calendar,      label: 'Week Off Assignment',     path: '/admin/week-off-management' },
    ],
  },
  {
    title: 'Payroll & Salary',
    icon: Wallet,
    roles: ['hr'],
    items: [
      { icon: Wallet,    label: 'Payroll Management',  path: '/hr/payroll' },
      { icon: Banknote,  label: 'Salary Sheet',        path: '/hr/sheet' },
      { icon: CheckCircle2, label: 'Salary Approval',  path: '/hr/approval' },
      { icon: Calculator,   label: 'Salary Calculation', path: '/hr/salary-calculation' },
      { icon: CreditCard,   label: 'Payment Audit',    path: '/hr/payment-audit' },
    ],
  },
  {
    title: 'Employees',
    icon: Users,
    roles: ['hr'],
    items: [
      { icon: Users,    label: 'Employee Master',      path: '/hr/employee-master' },
      { icon: User,     label: 'Employee Profiles',    path: '/admin/employee-profiles' },
      { icon: Users,    label: 'Employee Directory',   path: '/employee-directory' },
    ],
  },
  {
    title: 'Onboarding',
    icon: UserPlus,
    roles: ['hr'],
    items: [
      { icon: UserPlus, label: 'New Employee',                path: '/onboarding/new-user' },
      { icon: History,  label: 'Onboarding Status',          path: '/onboarding/hr-access' },
    ],
  },

  // ── GM — Payment Approvals ONLY ──────────────────────────────────────────
  {
    title: 'FF Payment Approvals',
    icon: Banknote,
    roles: ['gm'],
    items: [
      { icon: Banknote,     label: 'Vendor Payments',    path: '/gm/ff-payments',           badgeKey: 'gm_vendor' },
      { icon: Truck,        label: 'Transport Payments', path: '/gm/ff-transport-payments', badgeKey: 'gm_transport' },
      { icon: FileBarChart, label: 'FF Payments Report', path: '/reports/ff-payments' },
    ],
  },

  // ── ADMIN — trimmed to exactly what an FF-operations overseer needs.
  // Every other role's own sections below are untouched; the ~14 groups
  // this replaced (Intelligence Hub, full FF Operations tree, HR & Payroll,
  // Reports, Executive Controls, etc.) are still reachable by other roles
  // via their own nav config or by URL — this is a nav declutter for
  // admin, not a route/permission change.
  {
    title: 'Admin',
    icon: LayoutDashboard,
    roles: ['admin'],
    items: [
      { icon: LayoutDashboard, label: 'Dashboard',                 path: '/admin-dashboard' },
      { icon: BarChart3,       label: 'FF Operations Overview',    path: '/ff-operations/gm-dashboard' },
      { icon: Sunrise,         label: 'Day Open / Close KPIs',      path: '/ff-operations/day-kpis' },
      { icon: ClipboardList,   label: 'Sales Orders',              path: '/sales/orders' },
      { icon: ShoppingCart,    label: 'Purchase Orders',           path: '/purchase/orders' },
      { icon: PackageCheck,    label: 'QC Overview',               path: '/admin/qc-overview' },
      { icon: Star,            label: 'Vendor Performance',        path: '/purchase/vendor-performance' },
      { icon: Truck,           label: 'Delivery Overview',         path: '/reports/delivery' },
      { icon: Banknote,        label: 'Vendor Payment Approval',   path: '/admin/ff-payments' },
      { icon: Truck,           label: 'Transport Payment Approval',path: '/admin/ff-transport-payments' },
      { icon: History,         label: 'Payment Batch History',    path: '/accounts/batch-history' },
      { icon: Wallet,          label: 'Customer Collections',      path: '/sales/collections' },
      { icon: Camera,          label: 'Shift Attendance',          path: '/admin/shift-attendance' },
      { icon: MapPin,          label: 'Pallikaranai Hub',          path: '/admin/hubs/palikarani' },
      { icon: MapPin,          label: 'Vanagaram Hub',             path: '/admin/hubs/vanagaram' },
      { icon: MapPin,          label: 'Hyderabad Hub',             path: '/admin/hubs/hyderabad' },
    ],
  },

  // ── FF OPERATIONS MANAGER ────────────────────────────────────────────────────
  {
    title: 'Operations Command',
    icon: LayoutDashboard,
    roles: ['ff_operations_manager'],
    items: [
      { icon: BarChart3,   label: '🏭 GM Dashboard',      path: '/ff-operations/gm-dashboard' },
      { icon: Store,       label: 'App & Web Orders',     path: '/sales/app-orders' },
      { icon: Target,      label: 'Task & Target Assign', path: '/ff-operations/task-assign' },
      { icon: Warehouse,   label: 'Hub Management',       path: '/admin/hubs' },
    ],
  },
  {
    title: 'Sales',
    icon: TrendingUp,
    roles: ['ff_operations_manager'],
    items: [
      {
        icon: TrendingUp, label: 'Sales', path: '/sales',
        children: [
          { label: 'Sales Dashboard', path: '/sales' },
          { label: 'All Orders',      path: '/sales/orders',      action: true },
          { label: 'Bulk Orders',     path: '/sales/bulk-order' },
          { label: 'Customers',       path: '/sales/customers' },
          { label: 'Invoices',        path: '/sales/invoices' },
          { label: 'Payments Received', path: '/sales/payments-received' },
          { label: 'Credit Notes',      path: '/sales/credit-notes' },
          { label: 'Recurring Invoices', path: '/sales/recurring-invoices' },
          { label: 'Collection Entry',      path: '/collections/entry' },
          { label: 'Collection Dashboard',  path: '/collections/dashboard' },
        ],
      },
    ],
  },
  {
    title: 'Purchase',
    icon: ShoppingCart,
    roles: ['ff_operations_manager'],
    items: [
      {
        icon: ShoppingCart, label: 'Purchase', path: '/purchase',
        children: [
          { label: 'Purchase Dashboard',  path: '/purchase' },
          { label: 'Purchase Orders',     path: '/purchase/orders' },
          { label: '⚡ EOD PO Engine',    path: '/ff-operations/eod-po-engine' },
          { label: 'Vendors',             path: '/purchase/vendors' },
          { label: 'New Vendor Payment',   path: '/ff/vendor-payment/new' },
          { label: 'New Transport Payment', path: '/ff/transport-payment/new' },
          { label: 'Vendor Bulk Payment',  path: '/ff-operations/vendor-bulk-payment' },
          { label: 'Payment Approvals',   path: '/ff-operations/payment-approvals', action: false },
          { label: 'Debit Notes',         path: '/purchase/debit-notes' },
          { label: 'Recurring Bills',     path: '/purchase/recurring-bills' },
        ],
      },
    ],
  },
  {
    title: 'Warehouse & QC',
    icon: Warehouse,
    roles: ['ff_operations_manager'],
    items: [
      {
        icon: Warehouse, label: 'Warehouse & QC', path: '/warehouse',
        children: [
          { label: 'Warehouse Dashboard', path: '/warehouse' },
          { label: 'QC Inspection',       path: '/warehouse/qc' },
          { label: 'Damage / Wastage Entry', path: '/warehouse/damage' },
          { label: 'EOD Wastage Entry',    path: '/warehouse/eod-wastage' },
          { label: 'QC Rejections',       path: '/warehouse/qc-rejections' },
          { label: 'Inventory',           path: '/warehouse/inventory' },
          { label: '📦 Smart Inventory',  path: '/ff-operations/inventory' },
          { label: 'Daily Stock Count',   path: '/warehouse/daily-stock' },
          { label: 'Daily Cash Closing',  path: '/accounts/daily-cash-closing' },
          { label: 'Returns',             path: '/warehouse/returns' },
        ],
      },
    ],
  },
  {
    title: 'Reports',
    icon: FileBarChart,
    roles: ['ff_operations_manager'],
    items: [
      { icon: Sunrise,      label: 'Day Open / Close KPIs', path: '/ff-operations/day-kpis' },
      { icon: FileBarChart, label: 'Reports Dashboard',    path: '/reports' },
      { icon: Banknote,     label: 'FF Payments Report',  path: '/reports/ff-payments' },
      { icon: BarChart3,    label: 'Daily Sales',         path: '/reports/sales' },
      { icon: ShoppingCart, label: 'Purchase Report',     path: '/reports/purchase' },
      { icon: Boxes,        label: 'Inventory Report',    path: '/reports/inventory' },
      { icon: PieChart,     label: 'P&L Report',          path: '/reports/pl' },
      { icon: Truck,        label: 'Delivery Report',     path: '/reports/delivery' },
    ],
  },

  // ── CEO — trimmed to FF only, mirroring admin's revamp. The other ~27 items
  // this replaced (Command Center, general Approvals, Projects, Administration,
  // Rentals, Onboarding) are IGO-Chain-governance/core-admin, not FF — still
  // reachable by URL (e.g. /ceo-dashboard), just not in CEO's nav anymore.
  {
    title: 'CEO',
    icon: LayoutDashboard,
    roles: ['ceo'],
    items: [
      { icon: BarChart3,       label: 'FF Overview',                     path: '/ceo/ff-overview' },
      { icon: LayoutDashboard, label: 'FF Operations Overview',          path: '/ff-operations/gm-dashboard' },
      { icon: ClipboardList,   label: 'Sales Orders',                    path: '/sales/orders' },
      { icon: ShoppingCart,    label: 'Purchase Orders',                 path: '/purchase/orders' },
      { icon: PackageCheck,    label: 'QC Overview',                     path: '/admin/qc-overview' },
      { icon: Star,            label: 'Vendor Performance',              path: '/purchase/vendor-performance' },
      { icon: Truck,           label: 'Delivery Overview',               path: '/reports/delivery' },
      { icon: Banknote,        label: 'Vendor Payment Approval (Final)', path: '/ceo/ff-payments' },
      { icon: Truck,           label: 'Transport Payment Approval (Final)', path: '/ceo/ff-transport-payments' },
      { icon: History,         label: 'Payment Batch History',          path: '/accounts/batch-history' },
      { icon: Wallet,          label: 'Customer Collections',            path: '/sales/collections' },
      { icon: FileBarChart,    label: 'FF Payments Report',              path: '/reports/ff-payments' },
      { icon: PieChart,        label: 'P&L Dashboard',                   path: '/reports/pl' },
      { icon: Wallet,          label: 'Balance Sheet',                   path: '/reports/balance-sheet' },
      { icon: MapPin,          label: 'Pallikaranai Hub',                path: '/admin/hubs/palikarani' },
      { icon: MapPin,          label: 'Vanagaram Hub',                   path: '/admin/hubs/vanagaram' },
      { icon: MapPin,          label: 'Hyderabad Hub',                   path: '/admin/hubs/hyderabad' },
    ],
  },

  // ── Accounts — approve-only for the FF payment chain, no other tooling ───────
  {
    title: 'FF Payments',
    icon: Banknote,
    roles: ['accounts'],
    items: [
      { icon: Banknote,     label: 'FF Vendor Payments',    path: '/accounts/ff-payments' },
      { icon: Truck,        label: 'FF Transport Payments', path: '/accounts/ff-transport-payments' },
      { icon: Layers,       label: 'Execution Desk',        path: '/accounts/execution-desk' },
      { icon: History,      label: 'Batch History',         path: '/accounts/batch-history' },
      { icon: FileBarChart, label: 'FF Payments Report',    path: '/reports/ff-payments' },
    ],
  },

  // ── Books of Accounts — double-entry ledger (accounts/admin write; ceo/director/auditor read)
  {
    title: 'Books of Accounts',
    icon: Landmark,
    roles: ['accounts', 'admin', 'ceo', 'director', 'Director', 'auditor'],
    items: [
      { icon: NotebookPen,  label: 'Vouchers & Day Book',   path: '/accounts/books/vouchers' },
      { icon: BookOpen,     label: 'General Ledger',        path: '/accounts/books/ledger' },
      { icon: Scale,        label: 'Trial Balance',         path: '/accounts/books/trial-balance' },
      { icon: PieChart,     label: 'P&L / Balance Sheet',   path: '/accounts/books/statements' },
      { icon: Hourglass,    label: 'Receivables & Payables', path: '/accounts/books/ageing' },
      { icon: ListTree,     label: 'Chart of Accounts',     path: '/accounts/books/chart' },
      { icon: Building2,    label: 'Fixed Asset Register',  path: '/accounts/fixed-assets' },
      { icon: Wallet,       label: 'Daily Cash Closing',    path: '/accounts/daily-cash-closing' },
      { icon: Settings,     label: 'Books Settings',        path: '/accounts/books/settings' },
    ],
  },

  // ── Asset Management — financial register + operational fleet compliance ──────
  {
    title: 'Asset Management',
    icon: Building2,
    roles: ['admin', 'ceo', 'gm', 'ff_operations_manager'],
    items: [
      { icon: Building2, label: 'Fixed Asset Register', path: '/accounts/fixed-assets' },
      { icon: Truck,     label: 'Vehicle Management',   path: '/admin/vehicles' },
      { icon: Package,   label: 'Crate Tracking',        path: '/admin/crates' },
      { icon: ArrowRightLeft, label: 'Asset Transfers',  path: '/admin/asset-transfers' },
      { icon: ClipboardCheck, label: 'Physical Verification', path: '/admin/asset-verification' },
    ],
  },

  // ── Purchase Head ────────────────────────────────────────────────────────────
  {
    title: 'Command Center',
    icon: LayoutDashboard,
    roles: ['purchase_head'],
    items: [
      { icon: Truck, label: 'Purchase Dashboard', path: '/purchase-dashboard' },
    ],
  },

  // ── Vendor Head ──────────────────────────────────────────────────────────────
  {
    title: 'Command Center',
    icon: LayoutDashboard,
    roles: ['vendor_head'],
    items: [
      { icon: Truck, label: 'Vendor Sourcing', path: '/vendor-sourcing/dashboard' },
    ],
  },

  // ── Farm Manager ─────────────────────────────────────────────────────────────
  {
    title: 'Farm Operations',
    icon: LayoutDashboard,
    roles: ['farmmanager'],
    items: [
      { icon: BarChart3,    label: 'Farm Dashboard',    path: '/farm/dashboard' },
      { icon: Camera,       label: 'Site Updates',      path: '/site-manager/dashboard' },
      { icon: Package,      label: 'Project Inventory', path: '/inventory' },
      { icon: FolderKanban, label: 'Projects',          path: '/employee-projects' },
    ],
  },

  // ── Auditor — Payment Audit ONLY ─────────────────────────────────────────────
  {
    title: 'FF Payment Audit',
    icon: ShieldCheck,
    roles: ['auditor'],
    items: [
      { icon: Banknote,     label: 'Vendor Payments',    path: '/auditor/ff-payments',           badgeKey: 'auditor_vendor' },
      { icon: Truck,        label: 'Transport Payments', path: '/auditor/ff-transport-payments', badgeKey: 'auditor_transport' },
      { icon: FileBarChart, label: 'FF Payments Report', path: '/reports/ff-payments' },
    ],
  },

  // ── Rental (RSH) ────────────────────────────────────────────────────────────
  {
    title: 'Rental Management',
    icon: Banknote,
    roles: ['rsh', 'RSH'],
    departments: ['rental sourcing'],
    items: [
      { icon: ClipboardList, label: 'My Rentals',       path: '/rsh/rentals' },
      { icon: History,       label: 'Payment History',  path: '/rentals/payment-history' },
    ],
  },

  // ── Weekly Productivity (core heads / managers) ───────────────────────────
  {
    title: 'Weekly Productivity',
    icon: BarChart3,
    roles: [
      'employee', 'admin', 'hr', 'ceo', 'gm', 'gmo', 'smo', 'nsm',
      'director', 'Director', 'auditor', 'rsh', 'RSH',
      'site_visit_farm_manager', 'farmmanager', 'palm_cafe_manager', 'cafe_manager', 'boi',
    ],
    items: [
      { icon: LayoutDashboard, label: 'Weekly Targets',      path: '/core-head/targets' },
      { icon: ClipboardCheck,  label: 'Weekly Achievements', path: '/core-head/achievements' },
    ],
  },

  // ── Site Visit ───────────────────────────────────────────────────────────────
  {
    title: 'Site Visit',
    icon: MapPin,
    roles: ['smo'],
    departments: ['site visit'],
    items: [
      { icon: LayoutDashboard, label: 'Visit Dashboard', path: '/site-visit-fm-dashboard' },
    ],
  },
  {
    title: 'Site Visit',
    icon: MapPin,
    roles: ['site_visit_farm_manager', 'farmmanager', 'employee', 'rsh', 'RSH', 'smo'],
    departments: ['rental sourcing', 'site visit', 'farm manager'],
    items: [
      { icon: LayoutDashboard, label: 'Visit Dashboard', path: '/site-visit-fm-dashboard' },
      { icon: Plus,            label: 'New Request',     path: '/site-visit-request/new' },
      { icon: History,         label: 'My Requests',     path: '/site-visit-request/my' },
    ],
  },

  // ── SALES TEAM (field_executive, bde, tele_caller) ──────────────────────────
  {
    title: 'Sales',
    icon: TrendingUp,
    roles: ['field_executive', 'bde', 'tele_caller', 'back_office'],
    items: [
      { icon: LayoutDashboard, label: 'Sales Dashboard',  path: '/sales' },
      { icon: Plus,            label: 'New Order',        path: '/sales/new-order' },
      { icon: Upload,          label: 'Bulk Order',       path: '/sales/bulk-order' },
      { icon: ClipboardList,   label: 'All Orders',       path: '/sales/orders' },
      { icon: Store,           label: 'App & Web Orders', path: '/sales/app-orders' },
      { icon: Users,           label: 'Customers',        path: '/sales/customers' },
      { icon: FileText,        label: 'Invoices',         path: '/sales/invoices' },
      { icon: Target,          label: 'Sales Targets',    path: '/sales/targets' },
      { icon: DollarSign,      label: 'Payments Received', path: '/sales/payments-received' },
      { icon: FileText,        label: 'Credit Notes',      path: '/sales/credit-notes' },
      { icon: RefreshCw,       label: 'Recurring Invoices', path: '/sales/recurring-invoices' },
      { icon: Wallet,          label: 'Collection Entry',     path: '/collections/entry' },
      { icon: BarChart3,       label: 'Collection Dashboard', path: '/collections/dashboard' },
    ],
  },
  {
    title: "Today's Tasks",
    icon: CheckCircle2,
    roles: ['field_executive', 'bde', 'tele_caller'],
    items: [
      { icon: CheckCircle2, label: "My Tasks Today", path: '/sales/task-today' },
    ],
  },
  {
    title: 'Purchase',
    icon: ShoppingCart,
    roles: ['field_executive', 'bde', 'tele_caller', 'back_office'],
    items: [
      { icon: ClipboardList,    label: 'Purchase Orders', path: '/purchase/orders' },
      { icon: Zap,              label: 'EOD PO Engine',   path: '/ff-operations/eod-po-engine' },
      { icon: Database,         label: 'Vendors',         path: '/purchase/vendors' },
    ],
  },
  {
    title: 'Reports',
    icon: FileBarChart,
    roles: ['field_executive', 'bde', 'tele_caller'],
    items: [
      { icon: BarChart3,  label: 'Daily Sales Report', path: '/reports/sales' },
      { icon: CreditCard, label: 'Cash Collection',    path: '/reports/collection' },
    ],
  },

  // ── Shift Dashboard — shift_employee, purchase_manager & purchase_head ─────────
  {
    title: 'Shift',
    icon: Clock,
    roles: ['shift_employee', 'purchase_manager', 'purchase_head'],
    items: [
      { icon: LayoutDashboard, label: 'Shift Dashboard', path: '/shift/dashboard' },
    ],
  },

  // ── PURCHASE EXECUTIVE (shift_employee, purchase_manager, purchase_head) ───────
  {
    title: 'My PO Queue',
    icon: ShoppingCart,
    roles: ['shift_employee', 'purchase_manager', 'purchase_head'],
    items: [
      { icon: LayoutDashboard, label: 'Purchase Dashboard',  path: '/purchase' },
      { icon: ClipboardList,   label: 'My Purchase Orders',  path: '/purchase/orders' },
      { icon: Package,         label: 'Buy (Go Purchase)',   path: '/purchase/buy' },
    ],
  },
  {
    title: 'Vendors',
    icon: Database,
    roles: ['shift_employee', 'purchase_manager', 'purchase_head'],
    items: [
      { icon: Database,   label: 'Vendors',         path: '/purchase/vendors' },
      { icon: BarChart3,  label: 'Rate Comparison', path: '/purchase/rate-comparison' },
      { icon: TrendingUp, label: 'Market Rates',    path: '/purchase/market-rates' },
    ],
  },
  {
    // Purchase Executives (shift_employee) raise Transport payments manually for
    // their hub's buys — Ops Manager and Anusiya's payment-access flag are
    // approve-only now. Vendor payment raising deliberately excluded here: their
    // vendor payments come from BuyPage.tsx's automatic creation on a completed
    // buy, not a manual form.
    title: 'Payments',
    icon: CreditCard,
    roles: ['shift_employee'],
    items: [
      { icon: Truck,       label: 'New Transport Payment',    path: '/ff/transport-payment/new' },
      { icon: History,     label: 'My Submitted Payments',    path: '/my-submitted-payments' },
      { icon: History,     label: 'Payments Made',            path: '/purchase/payments-made' },
    ],
  },
  {
    // purchase_manager / purchase_head keep full raise access (both vendor and
    // transport) -- only hub_manager and shift_employee had it removed.
    title: 'Payments',
    icon: CreditCard,
    roles: ['purchase_manager', 'purchase_head'],
    items: [
      { icon: Plus,        label: 'New FF Vendor Payment',    path: '/ff/vendor-payment/new' },
      { icon: Truck,       label: 'New Transport Payment',    path: '/ff/transport-payment/new' },
      { icon: History,     label: 'My Submitted Payments',    path: '/my-submitted-payments' },
      { icon: History,     label: 'Payments Made',            path: '/purchase/payments-made' },
    ],
  },

  // ── Shift Dashboard — hub_manager ────────────────────────────────────────────
  {
    title: 'Shift',
    icon: Clock,
    roles: ['hub_manager'],
    items: [
      { icon: LayoutDashboard, label: 'Shift Dashboard', path: '/shift/dashboard' },
    ],
  },

  // ── HUB MANAGER (unified: warehouse + QC + inventory) ────────────────────────
  {
    title: 'My Hub',
    icon: Warehouse,
    roles: ['hub_manager'],
    items: [
      { icon: LayoutDashboard, label: 'Warehouse Dashboard', path: '/warehouse' },
      { icon: ClipboardList,   label: 'Purchase Orders',     path: '/purchase/orders' },
      { icon: ClipboardCheck,  label: 'PO Assignment',       path: '/warehouse/po-assignment' },
      { icon: History,         label: 'PO History',          path: '/warehouse/po-history' },
      { icon: PackageCheck,    label: 'QC Inspection',       path: '/warehouse/qc' },
      { icon: AlertTriangle,   label: 'Damage / Wastage Entry', path: '/warehouse/damage' },
      { icon: AlertTriangle,   label: 'EOD Wastage Entry',    path: '/warehouse/eod-wastage' },
      { icon: FileText,        label: 'QC Rejections',       path: '/warehouse/qc-rejections' },
      { icon: RotateCcw,       label: 'Returns',             path: '/warehouse/returns' },
    ],
  },
  {
    // Vendor payment raising deliberately excluded for hub_manager -- only
    // Transport Payments may be raised manually here; vendor payments come
    // from BuyPage.tsx's automatic creation on a completed buy.
    title: 'Payments',
    icon: Banknote,
    roles: ['hub_manager'],
    items: [
      { icon: Truck,       label: 'New Transport Payment', path: '/ff/transport-payment/new' },
      { icon: History,     label: 'My Submitted Payments', path: '/my-submitted-payments' },
    ],
  },
  {
    title: 'Inventory',
    icon: Boxes,
    roles: ['hub_manager'],
    items: [
      { icon: Package, label: 'Inventory Dashboard', path: '/warehouse/inventory' },
      { icon: Boxes,   label: 'Smart Inventory',     path: '/ff-operations/inventory' },
      { icon: ClipboardList, label: 'Daily Stock Count', path: '/warehouse/daily-stock' },
    ],
  },
  {
    title: 'Cash Management',
    icon: Wallet,
    roles: ['hub_manager'],
    items: [
      { icon: Wallet, label: 'Daily Cash Closing', path: '/accounts/daily-cash-closing' },
    ],
  },
  {
    title: 'Reports',
    icon: FileBarChart,
    roles: ['hub_manager'],
    items: [
      { icon: Boxes, label: 'Inventory Report', path: '/reports/inventory' },
    ],
  },

  // ── L1 MANAGER — Payment Approvals ONLY ─────────────────────────────────────
  {
    title: 'L1 Payment Approvals',
    icon: CheckSquare,
    roles: ['l1_manager'],
    items: [
      { icon: Banknote,     label: 'Vendor Payments',    path: '/l1/payments',           badgeKey: 'l1_vendor' },
      { icon: Truck,        label: 'Transport Payments', path: '/l1/transport-payments', badgeKey: 'l1_transport' },
      { icon: FileBarChart, label: 'FF Payments Report', path: '/reports/ff-payments' },
    ],
  },

  // ── Tele-Caller CRM ───────────────────────────────────────────────────────────
  {
    title: 'Tele-Caller CRM',
    icon: PhoneCall,
    roles: ['tele_caller', 'back_office'],
    items: [
      { icon: LayoutDashboard, label: 'CRM Dashboard', path: '/tele-caller' },
    ],
  },

  // ── Logistics (Driver) ────────────────────────────────────────────────────────
  {
    title: 'Logistics',
    icon: Truck,
    roles: ['driver'],
    items: [
      { icon: LayoutDashboard, label: 'Trips Dashboard', path: '/logistics' },
      { icon: Truck,           label: 'Driver View',     path: '/driver' },
    ],
  },

  // ── Product Catalog ───────────────────────────────────────────────────────────
  {
    title: 'Product Catalog',
    icon: Store,
    roles: ['purchase_manager', 'purchase_head', 'back_office'],
    items: [
      { icon: Package, label: 'All Products', path: '/catalog' },
      { icon: Plus,    label: 'Add Product',  path: '/catalog/new' },
    ],
  },

  // ── Finance & Reports (back_office) ──────────────────────────────────────────
  {
    title: 'Finance',
    icon: Wallet,
    roles: ['back_office'],
    items: [
      { icon: LayoutDashboard, label: 'Finance Dashboard', path: '/finance' },
    ],
  },
  {
    title: 'Reports',
    icon: FileBarChart,
    roles: ['back_office'],
    items: [
      { icon: FileBarChart, label: 'Reports Dashboard', path: '/reports' },
      { icon: PieChart,     label: 'P&L Report',        path: '/reports/pl' },
      { icon: BarChart3,    label: 'Custom Report',     path: '/reports/custom' },
    ],
  },
];

// ── Sidebar Component ─────────────────────────────────────────────────────────
export function Sidebar() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { dayStart } = useDayStart(new Date());
  const { isCoreHead } = useIsCoreHead();
  const pendingCounts = useFFPaymentCount();
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // Auto-expand if a child route is active
  useEffect(() => {
    navigationConfig.forEach(group => {
      group.items.forEach(item => {
        if (item.children) {
          const childActive = item.children.some(c => location.pathname.startsWith(c.path));
          if (childActive) {
            setExpandedItems(prev => new Set([...prev, item.path]));
          }
        }
      });
    });
  }, [location.pathname]);

  const toggleExpand = (path: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (!user) return null;

  const userRole = (user.role || 'employee').toLowerCase();
  const userDepartment = user.department?.toLowerCase() || '';

  const filteredGroups = navigationConfig.filter(group => {
    if (group.items.length === 0) return false;

    if (group.title.toLowerCase().includes('palm cafe') && group.roles.includes('palm_cafe_manager')) {
      return userRole.includes('cafe') || userDepartment.includes('cafe');
    }

    if (group.title === 'Weekly Productivity') {
      // ceo excluded even when core_heads-flagged — IGO-Chain performance
      // tracking, out of scope for ceo's FF-only sidebar.
      return userRole !== 'ceo' && (isCoreHead || ['palm_cafe_manager', 'cafe_manager'].includes(userRole));
    }

    const roleMatches = group.roles.some(r => r.toLowerCase() === userRole);
    if (!roleMatches) return false;

    if (userRole !== 'admin' && userRole !== 'ceo') {
      if (group.departments && group.departments.length > 0) {
        const inAllowedDept = group.departments.some(d => userDepartment.includes(d.toLowerCase()));
        if (!inAllowedDept) return false;
      }
      if (group.excludeDepartments && group.excludeDepartments.length > 0) {
        const inExcludedDept = group.excludeDepartments.some(d => userDepartment.includes(d.toLowerCase()));
        if (inExcludedDept) return false;
      }
    }

    return true;
  });

  // ff_payment_access: specific individuals (Anusiya/Arun) with payment
  // access including raising new payments — see matching bypass in
  // App.tsx's ProtectedRoute.
  if ((user as any)?.ff_payment_access) {
    filteredGroups.push({
      title: 'Payments',
      icon: Banknote,
      roles: [],
      items: [
        { icon: Plus,            label: 'New Vendor Payment',      path: '/ff/vendor-payment/new' },
        { icon: Truck,           label: 'New Transport Payment',   path: '/ff/transport-payment/new' },
        { icon: History,        label: 'My Submitted Payments',  path: '/my-submitted-payments' },
        { icon: ClipboardCheck, label: 'Payment Approvals',      path: '/ff-operations/payment-approvals' },
      ],
    });

    filteredGroups.push({
      title: 'Warehouse & QC',
      icon: Warehouse,
      roles: [],
      items: [
        { icon: Warehouse,   label: 'Warehouse Dashboard', path: '/warehouse' },
        { icon: ClipboardCheck, label: 'QC Inspection',    path: '/warehouse/qc' },
        { icon: ClipboardCheck, label: 'QC Rejections',    path: '/warehouse/qc-rejections' },
        { icon: Boxes,       label: 'Inventory',           path: '/warehouse/inventory' },
        { icon: History,     label: 'Returns',             path: '/warehouse/returns' },
      ],
    });
  }

  // Live filter — matches item labels, and (for items with a sub-menu)
  // child labels too; a matching child keeps its parent item (trimmed to
  // just the matching children) even if the parent's own label doesn't
  // match. A group survives only if at least one item still has something.
  const search = searchQuery.trim().toLowerCase();
  const searchedGroups = search
    ? filteredGroups
        .map(group => ({
          ...group,
          items: group.items
            .map(item => {
              const selfMatches = item.label.toLowerCase().includes(search);
              if (item.children && item.children.length > 0) {
                if (selfMatches) return item;
                const childMatches = item.children.filter(c => c.label.toLowerCase().includes(search));
                return childMatches.length > 0 ? { ...item, children: childMatches } : null;
              }
              return selfMatches ? item : null;
            })
            .filter((i): i is typeof group.items[number] => i !== null),
        }))
        .filter(group => group.items.length > 0)
    : filteredGroups;

  return (
    <aside className="flex flex-col w-[240px] h-full shrink-0"
      style={{ background: '#FFFFFF', borderRight: '1px solid #E5E7EB' }}>

      {/* Module search */}
      <div className="px-3 pt-3 pb-2 shrink-0" style={{ borderBottom: '1px solid #F3F4F6' }}>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search menu…"
            className="w-full text-[13px] rounded-lg pl-8 pr-8 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', color: '#374151' }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2"
              style={{ color: '#9CA3AF' }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {search && searchedGroups.length === 0 && (
          <p className="text-[11px] mt-1.5 px-0.5" style={{ color: '#9CA3AF' }}>No matching pages</p>
        )}
      </div>

      {/* Scrollable nav */}
      <div className="flex-1 overflow-y-auto py-3">
        <nav>
          {searchedGroups.map((group, groupIdx) => {
            const GroupIcon = group.icon;
            const isFirst = groupIdx === 0;

            return (
              <div key={`${group.title}-${group.roles.join('-')}-${(group.departments || []).join('-')}`}
                className={cn('pb-1', !isFirst && 'mt-3')}>

                {/* Section label */}
                {!isFirst && (
                  <div className="mx-4 mb-2" style={{ borderTop: '1px solid #F3F4F6' }} />
                )}
                <div className="flex items-center gap-1.5 px-4 pt-1 pb-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: '#9CA3AF' }}>
                    {group.title}
                  </span>
                </div>

                {/* Nav items */}
                <div className="space-y-0.5 px-2">
                  {group.items.map((item) => {
                    const Icon = item.icon;

                    if (item.path === '/cafe/manager' && !(userRole.includes('cafe') || userDepartment.includes('cafe'))) return null;
                    if (item.label.includes('Visit Dashboard') && !['smo', 'admin', 'ceo', 'site_visit_farm_manager'].includes(userRole)) return null;
                    if (userRole === 'employee' && (userDepartment.includes('jv') || userDepartment.includes('joint venture'))) {
                      const hiddenItems = ['Payment Request', 'My Escalations', 'Escalation Audit', 'Audits'];
                      if (hiddenItems.some(l => item.label.includes(l))) return null;
                    }

                    // ── Expandable item with children ──────────────────────
                    if (item.children && item.children.length > 0) {
                      const isExpanded = search ? true : expandedItems.has(item.path);
                      const isParentActive = location.pathname === item.path || item.children.some(c => location.pathname.startsWith(c.path));

                      return (
                        <div key={item.path}>
                          {/* Parent row */}
                          <button
                            onClick={() => toggleExpand(item.path)}
                            className={cn(
                              'w-full flex items-center gap-2.5 py-2 pr-2 pl-[9px] rounded-xl text-[13px] font-medium transition-all duration-150 border-l-[3px]',
                              isParentActive
                                ? 'bg-[#EFF6FF] text-[#2563EB] border-l-[#2563EB]'
                                : 'text-[#6B7280] border-l-transparent hover:bg-[#F9FAFB] hover:text-[#374151]'
                            )}
                          >
                            <Icon className="w-[14px] h-[14px] shrink-0" />
                            <span className="truncate leading-none flex-1 text-left">{item.label}</span>
                            {isExpanded
                              ? <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
                              : <ChevronRightIcon className="w-3 h-3 shrink-0 opacity-40" />
                            }
                          </button>

                          {/* Children */}
                          {isExpanded && (
                            <div className="mt-0.5 ml-3 pl-3 space-y-0.5" style={{ borderLeft: '2px solid #E5E7EB' }}>
                              {item.children.map(child => (
                                <NavLink
                                  key={child.path}
                                  to={child.path}
                                  onClick={() => search && setSearchQuery('')}
                                  className={({ isActive }) => cn(
                                    'flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg text-[12px] font-medium transition-all duration-150',
                                    isActive
                                      ? 'bg-[#EFF6FF] text-[#2563EB]'
                                      : 'text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#374151]'
                                  )}
                                >
                                  <span className="truncate">{child.label}</span>
                                  {child.action && (
                                    <span
                                      onClick={e => { e.preventDefault(); e.stopPropagation(); navigate(child.path + '/new'); }}
                                      className="w-4 h-4 rounded flex items-center justify-center shrink-0 hover:bg-[#DBEAFE] transition-colors"
                                      style={{ color: '#2563EB' }}
                                    >
                                      <Plus className="w-3 h-3" />
                                    </span>
                                  )}
                                </NavLink>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    }

                    // ── Regular item ──────────────────────────────────────
                    const badgeCount = item.badgeKey ? (pendingCounts[item.badgeKey] || 0) : 0;
                    return (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        onClick={() => search && setSearchQuery('')}
                        className={({ isActive }) => cn(
                          'flex items-center gap-2.5 py-2 pr-3 rounded-xl text-[13px] font-medium transition-all duration-150 border-l-[3px]',
                          isActive
                            ? 'bg-[#EFF6FF] text-[#2563EB] border-l-[#2563EB] pl-[9px]'
                            : 'text-[#6B7280] border-l-transparent pl-[9px] hover:bg-[#F9FAFB] hover:text-[#374151]'
                        )}
                      >
                        <Icon className="w-[14px] h-[14px] shrink-0" />
                        <span className="truncate leading-none flex-1">{item.label}</span>
                        {badgeCount > 0 && (
                          <span className="ml-auto shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
                            {badgeCount > 99 ? '99+' : badgeCount}
                          </span>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </div>

      {/* Footer */}
      <div className="px-2 py-3 space-y-1" style={{ borderTop: '1px solid #F3F4F6', background: '#FFFFFF' }}>
        {(userRole === 'employee' || userRole === 'auditor') && dayStart && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-1"
            style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
            <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: '#2563EB' }} />
            <div className="min-w-0 flex-1">
              <p className="text-[9px] uppercase tracking-wider leading-none" style={{ color: '#93C5FD' }}>Logged in</p>
              <p className="text-[12px] font-bold leading-tight tabular-nums" style={{ color: '#2563EB' }}>
                {format(new Date(dayStart.submitted_at), 'HH:mm')}
              </p>
            </div>
            {user.employeeId && (
              <span className="text-[10px] font-medium shrink-0" style={{ color: '#93C5FD' }}>{user.employeeId}</span>
            )}
          </div>
        )}

        {(user?.role === 'admin' || user?.role === 'ceo') && (
          <div className="flex justify-center px-1 mb-1">
            <ThemeSelector />
          </div>
        )}

        <a
          href="https://forms.gle/WDoNcZUXkp7BYZvZ7"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12.5px] font-medium transition-all duration-150"
          style={{ color: '#9CA3AF' }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = '#F9FAFB';
            (e.currentTarget as HTMLElement).style.color = '#374151';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.color = '#9CA3AF';
          }}
        >
          <MessageSquarePlus className="w-3.5 h-3.5 shrink-0" />
          <span>Feedback &amp; Suggestions</span>
        </a>
      </div>
    </aside>
  );
}

