// IGO CHAIN + FARMERS FACTORY — Combined ERP Type Definitions

export type UserRole =
  // ── IGO Chain roles ────────────────────────────────────────
  | 'employee'
  | 'hr'
  | 'admin'
  | 'ceo'
  | 'accounts'
  | 'overview'
  | 'smo'
  | 'gm'
  | 'gmo'
  | 'boi'
  | 'nsm'
  | 'datateam'
  | 'data_team'
  | 'farmmanager'
  | 'purchase_head'
  | 'vendor_head'
  | 'auditor'
  | 'director'
  | 'Director'
  | 'bd_data'
  | 'rsh'
  | 'site_visit_farm_manager'
  | 'cafe_manager'
  | 'palm_cafe_manager'
  // ── Farmers Factory roles (new) ────────────────────────────
  | 'purchase_manager'
  | 'warehouse_manager'
  | 'qc_manager'
  | 'field_executive'
  | 'tele_caller'
  | 'driver'
  | 'back_office'
  | 'shift_employee'
  | 'ff_operations_manager'
  | 'hub_manager'
  | 'l1_manager'
  | 'bde'
  | 'collection_executive';

// ── Role display labels ────────────────────────────────────────
export const ROLE_LABELS: Record<UserRole, string> = {
  // IGO Chain
  employee:               'Employee',
  hr:                     'HR Manager',
  admin:                  'Admin',
  ceo:                    'CEO',
  accounts:               'Accounts',
  smo:                    'SMO',
  gm:                     'General Manager',
  gmo:                    'GMO',
  boi:                    'BOI',
  nsm:                    'NSM',
  datateam:               'Data Team',
  data_team:              'Data Team',
  farmmanager:            'Farm Manager',
  purchase_head:          'Purchase Head',
  vendor_head:            'Vendor Head',
  auditor:                'Auditor',
  director:               'Director',
  Director:               'Director',
  bd_data:                'BD Data',
  rsh:                    'RSH',
  site_visit_farm_manager:'Site Visit FM',
  cafe_manager:           'Cafe Manager',
  palm_cafe_manager:      'Palm Cafe Manager',
  // Farmers Factory
  purchase_manager:       'Purchase Manager',
  warehouse_manager:      'Warehouse Manager',
  qc_manager:             'QC Manager',
  field_executive:        'Field Executive',
  tele_caller:            'Tele-Caller',
  driver:                 'Driver',
  back_office:               'Back Office',
  shift_employee:            'Shift Employee',
  ff_operations_manager:     'FF Operations Manager',
  hub_manager:               'Hub Manager',
  l1_manager:                'L1 Manager',
  bde:                       'BDE',
  overview:                  'Management Overview',
  collection_executive:      'Collection Executive',
};

// ── Role groupings ─────────────────────────────────────────────
export const MANAGEMENT_ROLES: UserRole[] = ['ceo', 'director', 'Director', 'gm', 'gmo', 'smo', 'boi', 'nsm', 'admin'];
export const OPERATIONS_ROLES: UserRole[] = ['purchase_manager', 'purchase_head', 'warehouse_manager', 'qc_manager', 'field_executive', 'tele_caller', 'driver', 'back_office', 'ff_operations_manager'];
export const HUB_SCOPED_ROLES: UserRole[] = ['warehouse_manager', 'qc_manager', 'hub_manager', 'driver', 'field_executive'];


export type LocationZone = 'back_office' | 'head_office' | 'site' | 'other';

export type SlotStatus = 'live' | 'late' | 'missed' | 'upcoming' | 'completed';

export type PaymentUrgency = 'emergency' | 'important' | 'normal';

export type PaymentStatus =
  | 'pending'
  | 'smo_audit'
  | 'gmo_audit'
  | 'director_audit'
  | 'boi_audit'
  | 'gm_audit'
  | 'admin_audit'
  | 'ceo_audit'
  | 'ceo_hold'
  | 'rejected'
  | 'paid'
  | 'smo_verified' // Legacy/Compatibility
  | 'gm_approved'  // Legacy/Compatibility
  | 'admin_approved' // Legacy/Compatibility
  | 'ceo_approved'; // Legacy/Compatibility

export type AttendanceStatus = 'present' | 'absent' | 'pending';

export interface User {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  department_type?: 'regular' | 'jv';
}

export interface DayStart {
  id: string;
  userId: string;
  date: string;
  loginTime: string;
  locationZone: LocationZone;
  otherReason?: string;
  gpsCoordinates?: { lat: number; lng: number };
  ipAddress?: string;
  isLocked: boolean;
  createdAt: string;
}

export interface DayPlan {
  id: string;
  userId: string;
  date: string;
  tasks: string[];
  expectedOutput: string;
  isProjectWork: boolean;
  dependency?: string;
  isLocked: boolean;
  createdAt: string;
}

export interface TimeSlot {
  id: string;
  slotNumber: number;
  startTime: string;
  endTime: string;
  isLunchBreak: boolean;
}

export interface HourlyReport {
  id: string;
  userId: string;
  date: string;
  slotId: string;
  taskPerformed: string;
  outputDelivered: string;
  proofUrl?: string;
  status: SlotStatus;
  submittedAt?: string;
  lateByMinutes?: number;
  isLocked: boolean;
}

export interface EODSummary {
  id: string;
  userId: string;
  date: string;
  workSummary: string;
  issuesFaced: string;
  spillover: string;
  evidenceLinks: string[];
  plannedVsDone: number;
  idleTimePercent: number;
  isLocked: boolean;
  createdAt: string;
}

export interface PaymentRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  department: string;
  isProjectWork: boolean;
  purpose: string;
  woNumber?: string;
  vendorName: string;
  vendorBankDetails: string;
  vendorBankDetailsConfirm: string;
  amount: number;
  billUrl: string;
  workProofUrl: string;
  cutoffDate: string;
  cutoffTime: string;
  urgency: PaymentUrgency;
  status: PaymentStatus;
  declaration: boolean;
  smoApprovedBy?: string;
  smoApprovedAt?: string;
  gmoApprovedBy?: string;
  gmoApprovedAt?: string;
  directorApprovedBy?: string;
  directorApprovedAt?: string;
  boiApprovedBy?: string;
  boiApprovedAt?: string;
  gmApprovedBy?: string;
  gmApprovedAt?: string;
  adminApprovedBy?: string;
  adminApprovedAt?: string;
  adminRejectionReason?: string;
  ceoApprovedBy?: string;
  ceoApprovedAt?: string;
  ceoHoldReason?: string;
  paidBy?: string;
  paidAt?: string;
  utrNumber?: string;
  paymentProofUrl?: string;
  auditTimeline?: any[];
  isSplitPayment?: boolean;
  splitBatchId?: string;
  totalSplits?: number;
  isJvPayment?: boolean;
  createdAt: string;
}

export interface AttendanceDecision {
  id: string;
  userId: string;
  date: string;
  loginTime?: string;
  locationZone?: LocationZone;
  hasDayPlan: boolean;
  slotCompliancePercent: number;
  previousScore: number;
  status: AttendanceStatus;
  decidedBy?: string;
  decidedAt?: string;
}


export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeState?: string;
  afterState: string;
  declaration?: string;
  timestamp: string;
  ipAddress?: string;
}

// Time slots configuration
export const TIME_SLOTS: TimeSlot[] = [
  { id: '1', slotNumber: 1, startTime: '10:00', endTime: '11:00', isLunchBreak: false },
  { id: '2', slotNumber: 2, startTime: '11:00', endTime: '12:00', isLunchBreak: false },
  { id: '3', slotNumber: 3, startTime: '12:00', endTime: '13:00', isLunchBreak: false },
  { id: '4', slotNumber: 4, startTime: '13:00', endTime: '14:00', isLunchBreak: false },
  { id: '5', slotNumber: 5, startTime: '14:00', endTime: '14:45', isLunchBreak: true },
  { id: '6', slotNumber: 6, startTime: '14:45', endTime: '16:00', isLunchBreak: false },
  { id: '7', slotNumber: 7, startTime: '16:00', endTime: '17:00', isLunchBreak: false },
  { id: '8', slotNumber: 8, startTime: '17:00', endTime: '18:00', isLunchBreak: false },
  { id: '9', slotNumber: 9, startTime: '18:00', endTime: '19:30', isLunchBreak: false },
];
