import React, { useState, useMemo } from 'react';
import { CommunityEvent, EventRegistration, EventCommittee, Family, FamilyMember, EventCommitteeExpense, ResidentProfile } from '../types';
import RegistrationReportingWorkspace from './RegistrationReportingWorkspace';
import { 
  TrendingUp, 
  FileText, 
  Settings, 
  ArrowDownCircle, 
  PieChart, 
  CreditCard, 
  Receipt, 
  Search, 
  AlertCircle, 
  Plus, 
  DollarSign, 
  Calendar, 
  CheckCircle2, 
  AlertTriangle, 
  X, 
  Trash2, 
  Edit3, 
  Download,
  Info,
  ShieldCheck,
  User,
  Building,
  Wallet,
  Users,
  Clock,
  Check,
  Ban,
  Lock,
  ArrowRight,
  HandCoins,
  FileCheck,
  FileSpreadsheet,
  Play
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { db, functions } from '../context/AuthContext';
import { doc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { createAuditLog } from '../utils/audit';
import { useLocalGEASConfirmation, GEASConfirmationDialogUI } from './gmk/GEASConfirmationDialog';

export function formatCategoryLabel(rawIdOrName?: string | null): string {
  if (!rawIdOrName) return 'Event';
  const val = String(rawIdOrName).trim();
  const lower = val.toLowerCase();
  if (
    lower === 'event_expense' ||
    lower === 'event expense' ||
    lower === 'event' ||
    lower === 'events' ||
    lower === 'event expenses' ||
    lower === 'event-level expense' ||
    lower === 'event-level' ||
    lower === 'event level'
  ) {
    return 'Event';
  }
  return val;
}

export const isFinanceOwnedExpense = (exp: {
  id?: string;
  createdScope?: string;
  createdByScope?: string;
  committeeId?: string;
  committeeName?: string;
  categoryId?: string;
  categoryName?: string;
  createdBy?: string;
}): boolean => {
  if (exp.createdScope === 'finance' || exp.createdScope === 'event') return true;
  if (exp.createdScope === 'committee') return false;
  if (exp.createdByScope === 'finance' || exp.createdByScope === 'event') return true;
  if (exp.committeeId === 'EVENT_EXPENSE' || exp.committeeId === 'event') return true;
  if (exp.committeeName && formatCategoryLabel(exp.committeeName) === 'Event') return true;
  if (exp.categoryName && formatCategoryLabel(exp.categoryName) === 'Event') return true;
  if (exp.categoryId === 'EVENT_EXPENSE' || exp.categoryId === 'event') return true;
  if (exp.id && (exp.id.startsWith('exp_event_') || exp.id.startsWith('exp_finance_'))) return true;
  return false;
};

export const getExpensePayeeDisplayName = (exp: EventCommitteeExpense): string => {
  if (exp.paidByName && exp.paidByName.trim()) {
    return exp.paidByName.trim();
  }
  if (exp.payee && exp.payee.trim()) {
    return exp.payee.trim();
  }
  if (exp.paidByType === 'resident' || exp.isPersonalPayment) {
    return 'Resident';
  }
  if (exp.paidByType === 'sponsor') {
    return 'Sponsor';
  }
  return 'Event Treasury';
};

export const getExpensePayeeTooltip = (exp: EventCommitteeExpense): string => {
  const parts: string[] = [];
  if (exp.paidByType === 'resident' || exp.isPersonalPayment) {
    parts.push('Payment Source: Resident Out-of-Pocket');
    if (exp.paidByName) parts.push(`Name: ${exp.paidByName}`);
    if (exp.paidByResidentId) parts.push(`GMK ID: ${exp.paidByResidentId}`);
    if (exp.paidByUnit) parts.push(`Unit: ${exp.paidByUnit}`);
    if (exp.paidByPhone) parts.push(`Phone: ${exp.paidByPhone}`);
    if (exp.paidByEmail) parts.push(`Email: ${exp.paidByEmail}`);
    if (exp.payee && exp.payee !== exp.paidByName) parts.push(`Vendor / Payee: ${exp.payee}`);
  } else if (exp.paidByType === 'sponsor') {
    parts.push('Payment Source: Registered Sponsor');
    if (exp.paidByName) parts.push(`Sponsor: ${exp.paidByName}`);
    if (exp.payee && exp.payee !== exp.paidByName) parts.push(`Vendor / Payee: ${exp.payee}`);
  } else {
    parts.push('Payment Source: Event Treasury');
    if (exp.payee) parts.push(`Vendor / Payee: ${exp.payee}`);
  }
  return parts.join(' | ');
};

export const getExpenseLifecycleStatus = (exp: EventCommitteeExpense & { isFinanceOwned?: boolean }): {
  code: 'pending' | 'approved' | 'refund_pending' | 'refunded' | 'settled' | 'rejected';
  label: string;
  badgeClass: string;
} => {
  const isFin = exp.isFinanceOwned ?? isFinanceOwnedExpense(exp);
  const isNonTreasury = exp.paidByType === 'resident' || exp.paidByType === 'sponsor' || exp.isPersonalPayment;
  const isSettled = exp.settlementStatus === 'settled' || exp.payableStatus === 'refunded';

  if (exp.financeStatus === 'rejected') {
    return {
      code: 'rejected',
      label: 'Rejected',
      badgeClass: 'bg-rose-100 text-rose-800 border border-rose-200'
    };
  }

  if (!isFin && (exp.financeStatus === 'pending' || !exp.financeStatus)) {
    return {
      code: 'pending',
      label: 'Pending Review',
      badgeClass: 'bg-amber-100 text-amber-800 border border-amber-300'
    };
  }

  // Accepted by Finance (or Finance Owned)
  if (isNonTreasury) {
    if (isSettled) {
      return {
        code: 'refunded',
        label: 'Refunded',
        badgeClass: 'bg-emerald-100 text-emerald-800 border border-emerald-200'
      };
    }
    return {
      code: 'refund_pending',
      label: 'Refund Pending',
      badgeClass: 'bg-sky-100 text-sky-800 border border-sky-300'
    };
  }

  // Treasury Expense
  if (isSettled) {
    return {
      code: 'settled',
      label: 'Settled',
      badgeClass: 'bg-emerald-100 text-emerald-800 border border-emerald-200'
    };
  }

  return {
    code: 'approved',
    label: 'Approved',
    badgeClass: 'bg-emerald-100 text-emerald-800 border border-emerald-200'
  };
};

interface FinanceWorkspaceProps {
  activeEvent: CommunityEvent | null;
  events: CommunityEvent[];
  registrations: EventRegistration[];
  eventFinance: any;
  handleUpdateFinance: (updates: any) => Promise<void>;
  profile: any;
  activeCommittees: EventCommittee[];
  setSuccessMsg: (msg: string | null) => void;
  setPaymentModalReg?: (reg: EventRegistration | null) => void;
  setErrorMsg: (msg: string | null) => void;
  families?: Family[];
  familyMembers?: FamilyMember[];
  residents?: ResidentProfile[];
  onDeleteRegistration?: (reg: EventRegistration) => void;
  isSubmitting?: boolean;
}

export function getRegistrationCollectedAmount(r: EventRegistration): number {
  const status = r.paymentStatus || 'pending';
  // Do NOT count: Cancelled, Refunded, Waived amounts as current income
  if (status === 'cancelled' || status === 'refunded' || status === 'waived') {
    return 0;
  }
  if (status === 'paid' || status === 'approved') {
    const due = r.amountDue ?? r.paymentAmount ?? r.paymentSummary?.totalAmount ?? 0;
    return r.amountReceived !== undefined ? r.amountReceived : due;
  }
  if (status === 'partially_paid' || status === 'overpaid' || status === 'refund_due') {
    return r.amountReceived || 0;
  }
  // Pending
  return r.amountReceived || 0;
}

export default function FinanceWorkspace({
  activeEvent,
  events,
  registrations,
  eventFinance,
  handleUpdateFinance,
  profile,
  activeCommittees,
  setSuccessMsg,
  setErrorMsg,
  setPaymentModalReg,
  families = [],
  familyMembers = [],
  residents = [],
  onDeleteRegistration,
  isSubmitting = false
}: FinanceWorkspaceProps) {
  const [financeTab, setFinanceTab] = useState<'summary' | 'events' | 'income' | 'budgets' | 'expenses' | 'refunds' | 'reports'>('summary');
  const [finSearchQuery, setFinSearchQuery] = useState('');
  const [isFinanceSubmitting, setIsFinanceSubmitting] = useState(false);

  // Modals state
  const { 
    confirm: confirmAction, 
    isOpen: isConfirmOpen, 
    options: confirmOptions, 
    handleCancel: handleCancelConfirm, 
    handleConfirm: handleConfirmAction 
  } = useLocalGEASConfirmation();

  const [showOpeningBalModal, setShowOpeningBalModal] = useState(false);
  const [openingBalInput, setOpeningBalInput] = useState<string>('');
  
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetCommittee, setBudgetCommittee] = useState<string>('');
  const [budgetAmountInput, setBudgetAmountInput] = useState<string>('');
  const [budgetDescInput, setBudgetDescInput] = useState<string>('');

  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<(EventCommitteeExpense & { committeeId: string; committeeName: string; isFinanceOwned?: boolean }) | null>(null);
  const [expenseCommittee, setExpenseCommittee] = useState<string>('');
  const [expenseAmountInput, setExpenseAmountInput] = useState<string>('');
  const [expenseDescInput, setExpenseDescInput] = useState<string>('');
  const [expenseDateInput, setExpenseDateInput] = useState<string>(new Date().toISOString().split('T')[0]);
  const [expensePayeeInput, setExpensePayeeInput] = useState<string>('');
  const [expensePaidByType, setExpensePaidByType] = useState<'event_treasury' | 'resident' | 'sponsor'>('event_treasury');
  const [expensePaidByResidentId, setExpensePaidByResidentId] = useState<string>('');
  const [expensePaidByName, setExpensePaidByName] = useState<string>('');
  const [expensePaidByUnit, setExpensePaidByUnit] = useState<string>('');
  const [expensePaidByPhone, setExpensePaidByPhone] = useState<string>('');
  const [expensePaidByEmail, setExpensePaidByEmail] = useState<string>('');
  const [expensePaidBySponsorId, setExpensePaidBySponsorId] = useState<string>('');
  const [residentSearchTerm, setResidentSearchTerm] = useState<string>('');
  const [payablesViewTab, setPayablesViewTab] = useState<'all' | 'pending' | 'settled'>('all');
  
  // Expenses Workspace Staged Filter State
  const [draftExpenseCommittee, setDraftExpenseCommittee] = useState<string>('all');
  const [draftExpenseStatus, setDraftExpenseStatus] = useState<'all' | 'pending' | 'approved' | 'refund_pending' | 'refunded' | 'settled' | 'rejected' | 'accepted'>('all');
  const [draftExpenseSearch, setDraftExpenseSearch] = useState<string>('');
  const [appliedExpenseCommittee, setAppliedExpenseCommittee] = useState<string>('all');
  const [appliedExpenseStatus, setAppliedExpenseStatus] = useState<'all' | 'pending' | 'approved' | 'refund_pending' | 'refunded' | 'settled' | 'rejected' | 'accepted'>('all');
  const [appliedExpenseSearch, setAppliedExpenseSearch] = useState<string>('');

  // Refunds & Payables Workspace Staged Filter State
  const [draftRefundFilterType, setDraftRefundFilterType] = useState<'all' | 'pending_payables' | 'settled_payables' | 'pending_refunds' | 'processed_refunds'>('all');
  const [draftRefundSearch, setDraftRefundSearch] = useState<string>('');
  const [appliedRefundFilterType, setAppliedRefundFilterType] = useState<'all' | 'pending_payables' | 'settled_payables' | 'pending_refunds' | 'processed_refunds'>('all');
  const [appliedRefundSearch, setAppliedRefundSearch] = useState<string>('');
  
  // Governance Review & Settlement Modals state
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectingExpense, setRejectingExpense] = useState<(EventCommitteeExpense & { committeeId: string; committeeName: string }) | null>(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState<string>('');

  const [showSettleModal, setShowSettleModal] = useState(false);
  const [settlingExpense, setSettlingExpense] = useState<(EventCommitteeExpense & { committeeId: string; committeeName: string }) | null>(null);
  const [settleMethodInput, setSettleMethodInput] = useState<string>('Bank Transfer');
  const [settleRefInput, setSettleRefInput] = useState<string>('');
  const [settleRemarksInput, setSettleRemarksInput] = useState<string>('');

  const [isSponsorshipModalOpen, setIsSponsorshipModalOpen] = useState(false);
  const [isRegistrationModalOpen, setIsRegistrationModalOpen] = useState(false);

  const userEmailLower = profile?.email?.toLowerCase().trim() || '';
  const userGmkIdUpper = profile?.gmkId?.toUpperCase().trim() || '';
  const userRoles = profile?.roles || [];
  const isED = userRoles.some((r: string) => ['event_director', 'admin', 'super_admin', 'president', 'vp', 'vice_president'].includes(r));
  
  const financeComm = activeCommittees.find(c => c.name.toLowerCase().includes('finance'));
  const financeLeads = (financeComm?.members || []).filter(m => m.role === 'Lead');
  const isFinanceLead = financeLeads.some(m => 
    (m.email && m.email.toLowerCase().trim() === userEmailLower) ||
    (m.residentId && m.residentId.toUpperCase().trim() === userGmkIdUpper)
  );

  const isFinanceAuth = isED || isFinanceLead;

  // Derived financial logic
  let totalRegistrationDue = 0;
  let totalRegistrationRec = 0;
  let payingRegistrationsCount = 0;
  
  registrations.forEach(r => {
    const due = r.amountDue ?? r.paymentAmount ?? r.paymentSummary?.totalAmount ?? 0;
    const rec = getRegistrationCollectedAmount(r);
    totalRegistrationDue += due;
    totalRegistrationRec += rec;
    if (rec > 0) payingRegistrationsCount++;
  });

  const sponsorshipIncomeList = (eventFinance?.sponsorshipIncome || []) as Array<{
    id?: string;
    sponsorName: string;
    tier?: string;
    amount: number;
    assuredAmount?: number;
    paymentMode?: string;
    date?: string;
    notes?: string;
  }>;
  const sponsorshipIncome = sponsorshipIncomeList.reduce((acc: number, curr: any) => acc + (Number(curr.amount) || 0), 0);
  const sponsorshipAssuredAmount = sponsorshipIncomeList.reduce((acc: number, curr: any) => acc + (Number(curr.assuredAmount) || Number(curr.amount) || 0), 0);
  
  const openingBalance = eventFinance?.openingBalance !== undefined ? Number(eventFinance.openingBalance) : 0;
  
  // Total Income = Registration Income + Sponsorship Income
  const totalIncome = totalRegistrationRec + sponsorshipIncome;

  // Committee Budgets
  const rawAllocations = eventFinance?.budgetAllocations || {};
  const allocations: Record<string, number> = {};
  Object.keys(rawAllocations).forEach(k => {
    const val = rawAllocations[k];
    allocations[k] = typeof val === 'object' ? Number(val?.amount || 0) : Number(val || 0);
  });
  const totalBudget = Object.values(allocations).reduce((acc: number, curr: number) => acc + curr, 0);

  // Centralized Expenses - aggregate from all active committees + Event Level Expenses
  const eventLevelExpensesList: Array<EventCommitteeExpense & { committeeId: string; committeeName: string; isFinanceOwned: boolean }> = 
    ((eventFinance?.eventExpenses || eventFinance?.expenses || []) as EventCommitteeExpense[]).map(exp => {
      const matchedComm = activeCommittees.find(c => c.id === exp.categoryId || c.name.toLowerCase() === (exp.categoryName || '').toLowerCase());
      const isFin = isFinanceOwnedExpense({ ...exp, committeeId: exp.categoryId || 'EVENT_EXPENSE', createdScope: exp.createdScope || 'finance' });
      return {
        ...exp,
        createdScope: exp.createdScope || 'finance',
        committeeId: matchedComm ? matchedComm.id : (exp.categoryId || 'EVENT_EXPENSE'),
        committeeName: matchedComm ? matchedComm.name : formatCategoryLabel(exp.categoryName || 'Event'),
        isFinanceOwned: isFin
      };
    });

  const committeeExpensesList: Array<EventCommitteeExpense & { committeeId: string; committeeName: string; isFinanceOwned: boolean }> = 
    activeCommittees.flatMap(c => 
      (c.expenses || []).map(exp => {
        const isFin = isFinanceOwnedExpense({ ...exp, committeeId: c.id, committeeName: c.name });
        return {
          ...exp,
          financeStatus: exp.financeStatus || 'pending',
          committeeId: c.id,
          committeeName: c.name,
          isFinanceOwned: isFin
        };
      })
    );

  // Combine and deduplicate by expense id so an expense migrated between collections doesn't duplicate
  const expenseMap = new Map<string, EventCommitteeExpense & { committeeId: string; committeeName: string; isFinanceOwned: boolean }>();
  committeeExpensesList.forEach(exp => {
    expenseMap.set(exp.id, exp);
  });
  eventLevelExpensesList.forEach(exp => {
    expenseMap.set(exp.id, exp);
  });

  const centralizedExpenses = Array.from(expenseMap.values())
    .sort((a, b) => new Date(b.date || (b as any).createdAt || 0).getTime() - new Date(a.date || (a as any).createdAt || 0).getTime());

  // Only ACCEPTED expenses count toward official financials & budget utilization
  const acceptedExpenses = centralizedExpenses.filter(e => 
    e.financeStatus === 'accepted' || (e.isFinanceOwned && e.financeStatus !== 'rejected')
  );
  const totalExpenses = acceptedExpenses.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  
  // Available Balance = Opening Balance + Registration Income + Sponsorship Income - Accepted Total Expenses
  const availableBalance = openingBalance + totalIncome - totalExpenses;

  // Payables / Reimbursements (ONLY Accepted Resident-paid or Sponsor-paid expenses)
  const acceptedNonTreasuryExpenses = useMemo(() => {
    return centralizedExpenses.filter(exp => {
      const isAccepted = exp.financeStatus === 'accepted' || (exp.isFinanceOwned && exp.financeStatus !== 'rejected');
      const isNonTreasury = exp.paidByType === 'resident' || exp.paidByType === 'sponsor' || exp.isPersonalPayment;
      return isAccepted && isNonTreasury;
    });
  }, [centralizedExpenses]);

  const pendingPayables = useMemo(() => {
    return acceptedNonTreasuryExpenses.filter(exp => exp.settlementStatus !== 'settled');
  }, [acceptedNonTreasuryExpenses]);

  const settledPayables = useMemo(() => {
    return acceptedNonTreasuryExpenses.filter(exp => exp.settlementStatus === 'settled');
  }, [acceptedNonTreasuryExpenses]);

  const totalPendingPayablesAmount = useMemo(() => {
    return pendingPayables.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  }, [pendingPayables]);

  const totalSettledPayablesAmount = useMemo(() => {
    return settledPayables.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  }, [settledPayables]);

  // Resident and Sponsor payer candidate lookups
  const residentCandidates = useMemo(() => {
    const list: Array<{
      key: string;
      residentId: string;
      fullName: string;
      unit: string;
      phone: string;
      email: string;
      relationship: 'Primary Member' | 'Spouse';
      displayLabel: string;
    }> = [];

    // 1. Check direct residents array if provided
    (residents || []).forEach(res => {
      if (res.gmkId || res.fullName) {
        const rGmkId = res.gmkId || '';
        list.push({
          key: `res_${rGmkId}`,
          residentId: rGmkId,
          fullName: res.fullName || '',
          unit: res.displayUnitNumber || '',
          phone: res.phone || '',
          email: res.email || '',
          relationship: 'Primary Member',
          displayLabel: `[${rGmkId}] ${res.fullName} (${res.displayUnitNumber || 'Unit N/A'}) — Primary Member`
        });
      }
    });

    // 2. Check families array
    (families || []).forEach(fam => {
      if (fam.primaryMemberGmkId || fam.fullName) {
        const pGmkId = fam.primaryMemberGmkId || (typeof fam.id === 'string' && fam.id.startsWith('fam_') ? fam.id.replace('fam_', '') : fam.id) || '';
        const exists = list.some(item => item.residentId === pGmkId);
        if (!exists) {
          list.push({
            key: `primary_${pGmkId}`,
            residentId: pGmkId,
            fullName: typeof fam.fullName === 'string' ? fam.fullName : '',
            unit: typeof fam.displayUnitNumber === 'string' ? fam.displayUnitNumber : '',
            phone: typeof fam.phone === 'string' ? fam.phone : (typeof fam.whatsAppNumber === 'string' ? fam.whatsAppNumber : ''),
            email: typeof fam.primaryMemberEmail === 'string' ? fam.primaryMemberEmail : '',
            relationship: 'Primary Member',
            displayLabel: `[${pGmkId}] ${typeof fam.fullName === 'string' ? fam.fullName : 'Unknown'} (${typeof fam.displayUnitNumber === 'string' ? fam.displayUnitNumber : 'Unit N/A'}) — Primary Member`
          });
        }
      }

      // Spouse from family doc
      if (fam.spouseName && typeof fam.spouseName === 'string' && fam.spouseName.trim()) {
        const pGmkId = fam.primaryMemberGmkId || (typeof fam.id === 'string' && fam.id.startsWith('fam_') ? fam.id.replace('fam_', '') : fam.id) || '';
        const spouseResidentId = `${pGmkId}_spouse`;
        const exists = list.some(item => item.residentId === spouseResidentId);
        if (!exists) {
          list.push({
            key: `spouse_${pGmkId}`,
            residentId: spouseResidentId,
            fullName: fam.spouseName.trim(),
            unit: typeof fam.displayUnitNumber === 'string' ? fam.displayUnitNumber : '',
            phone: typeof fam.spousePhone === 'string' ? fam.spousePhone : (typeof fam.spouseWhatsApp === 'string' ? fam.spouseWhatsApp : (typeof fam.phone === 'string' ? fam.phone : '')),
            email: typeof fam.spouseEmail === 'string' ? fam.spouseEmail : (typeof fam.primaryMemberEmail === 'string' ? fam.primaryMemberEmail : ''),
            relationship: 'Spouse',
            displayLabel: `[${pGmkId}] ${fam.spouseName.trim()} (${typeof fam.displayUnitNumber === 'string' ? fam.displayUnitNumber : 'Unit N/A'}) — Spouse (of ${typeof fam.fullName === 'string' ? fam.fullName : 'Unknown'})`
          });
        }
      }
    });

    // 3. Spouses from familyMembers
    (familyMembers || []).forEach(mem => {
      if (typeof mem.relationship === 'string' && mem.relationship.toLowerCase() === 'spouse' && typeof mem.name === 'string' && mem.name.trim()) {
        const pGmkId = typeof mem.familyId === 'string' ? mem.familyId.replace('fam_', '') : '';
        const alreadyExists = list.some(item => 
          item.relationship === 'Spouse' && (
            item.residentId === `${pGmkId}_spouse` || 
            item.fullName.toLowerCase() === mem.name.toLowerCase()
          )
        );
        if (!alreadyExists && pGmkId) {
          const parentFam = families.find(f => f.id === mem.familyId || f.primaryMemberGmkId === pGmkId);
          list.push({
            key: `mem_spouse_${mem.id || pGmkId}`,
            residentId: `${pGmkId}_spouse`,
            fullName: mem.name.trim(),
            unit: typeof parentFam?.displayUnitNumber === 'string' ? parentFam.displayUnitNumber : '',
            phone: typeof mem.phone === 'string' ? mem.phone : (typeof mem.whatsAppNumber === 'string' ? mem.whatsAppNumber : (typeof parentFam?.phone === 'string' ? parentFam.phone : '')),
            email: typeof parentFam?.primaryMemberEmail === 'string' ? parentFam.primaryMemberEmail : '',
            relationship: 'Spouse',
            displayLabel: `[${pGmkId}] ${mem.name.trim()} (${typeof parentFam?.displayUnitNumber === 'string' ? parentFam.displayUnitNumber : 'Unit N/A'}) — Spouse`
          });
        }
      }
    });

    return list.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [families, familyMembers, residents]);

  const filteredResidentCandidates = useMemo(() => {
    if (!residentSearchTerm.trim()) return residentCandidates.slice(0, 50);
    const q = residentSearchTerm.toLowerCase();
    return residentCandidates.filter(c => 
      c.fullName.toLowerCase().includes(q) ||
      c.residentId.toLowerCase().includes(q) ||
      c.unit.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [residentCandidates, residentSearchTerm]);

  const sponsorOptions = useMemo(() => {
    return (sponsorshipIncomeList || []).map((spon, idx) => {
      const name = typeof spon.sponsorName === 'string' ? spon.sponsorName : '';
      return {
        id: spon.id || `spon_${idx}`,
        name: name,
        amount: spon.amount,
        assuredAmount: spon.assuredAmount
      };
    }).filter(s => Boolean(s.name.trim()));
  }, [sponsorshipIncomeList]);

  // Helper to remove any undefined properties recursively to guarantee 100% Firestore safety
  const sanitizeFirestorePayload = <T,>(obj: T): T => {
    if (obj === null || obj === undefined) {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj
        .filter(item => item !== undefined)
        .map(item => sanitizeFirestorePayload(item)) as unknown as T;
    }
    if (typeof obj === 'object') {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj as Record<string, any>)) {
        if (value !== undefined) {
          result[key] = sanitizeFirestorePayload(value);
        }
      }
      return result as T;
    }
    return obj;
  };

  // Clean expense payload to avoid any undefined field errors in Firestore
  const cleanExpensePayload = (exp: Partial<EventCommitteeExpense>): EventCommitteeExpense => {
    const isResident = exp.paidByType === 'resident' || exp.isPersonalPayment;
    const isSponsor = exp.paidByType === 'sponsor';

    const cleaned: Record<string, any> = {
      id: exp.id || `exp_${Date.now()}`,
      date: exp.date || new Date().toISOString().split('T')[0],
      description: (exp.description || '').trim(),
      amount: Number(exp.amount) || 0,
      createdAt: exp.createdAt || new Date().toISOString(),
      createdBy: exp.createdBy || profile?.email || 'finance_lead',
      paidByType: exp.paidByType || 'event_treasury',
      isPersonalPayment: Boolean(isResident)
    };

    if (exp.categoryId && typeof exp.categoryId === 'string' && exp.categoryId.trim()) {
      cleaned.categoryId = exp.categoryId.trim();
    }
    if (exp.categoryName && typeof exp.categoryName === 'string' && exp.categoryName.trim()) {
      cleaned.categoryName = exp.categoryName.trim();
    }
    if (exp.payee && typeof exp.payee === 'string' && exp.payee.trim()) {
      cleaned.payee = exp.payee.trim();
    }
    if (exp.createdScope) {
      cleaned.createdScope = exp.createdScope;
    }

    if (isResident) {
      if (exp.paidByResidentId && exp.paidByResidentId.trim()) cleaned.paidByResidentId = exp.paidByResidentId.trim();
      if (exp.paidByName && exp.paidByName.trim()) cleaned.paidByName = exp.paidByName.trim();
      if (exp.paidByUnit && exp.paidByUnit.trim()) cleaned.paidByUnit = exp.paidByUnit.trim();
      if (exp.paidByPhone && exp.paidByPhone.trim()) cleaned.paidByPhone = exp.paidByPhone.trim();
      if (exp.paidByEmail && exp.paidByEmail.trim()) cleaned.paidByEmail = exp.paidByEmail.trim();
      if (exp.payableStatus) {
        cleaned.payableStatus = exp.payableStatus;
      }
      if (exp.refundedAmount !== undefined && exp.refundedAmount !== null) {
        cleaned.refundedAmount = Number(exp.refundedAmount) || 0;
      }
    } else if (isSponsor) {
      if (exp.paidBySponsorId && exp.paidBySponsorId.trim()) cleaned.paidBySponsorId = exp.paidBySponsorId.trim();
      if (exp.paidByName && exp.paidByName.trim()) cleaned.paidByName = exp.paidByName.trim();
      cleaned.isPersonalPayment = false;
    }

    if (exp.payableStatus) cleaned.payableStatus = exp.payableStatus;
    if (exp.refundedAmount !== undefined && exp.refundedAmount !== null) cleaned.refundedAmount = Number(exp.refundedAmount) || 0;
    if (exp.lastEditedBy && exp.lastEditedBy.trim()) cleaned.lastEditedBy = exp.lastEditedBy.trim();
    if (exp.lastEditedAt && exp.lastEditedAt.trim()) cleaned.lastEditedAt = exp.lastEditedAt.trim();
    if (exp.financeStatus) cleaned.financeStatus = exp.financeStatus;
    if (exp.acceptedBy && exp.acceptedBy.trim()) cleaned.acceptedBy = exp.acceptedBy.trim();
    if (exp.acceptedAt && exp.acceptedAt.trim()) cleaned.acceptedAt = exp.acceptedAt.trim();
    if (exp.rejectedBy && exp.rejectedBy.trim()) cleaned.rejectedBy = exp.rejectedBy.trim();
    if (exp.rejectedAt && exp.rejectedAt.trim()) cleaned.rejectedAt = exp.rejectedAt.trim();
    if (exp.rejectionReason && exp.rejectionReason.trim()) cleaned.rejectionReason = exp.rejectionReason.trim();
    if (exp.resubmittedBy && exp.resubmittedBy.trim()) cleaned.resubmittedBy = exp.resubmittedBy.trim();
    if (exp.resubmittedAt && exp.resubmittedAt.trim()) cleaned.resubmittedAt = exp.resubmittedAt.trim();
    if (exp.settlementStatus) cleaned.settlementStatus = exp.settlementStatus;
    if (exp.settledBy && exp.settledBy.trim()) cleaned.settledBy = exp.settledBy.trim();
    if (exp.settledAt && exp.settledAt.trim()) cleaned.settledAt = exp.settledAt.trim();
    if (exp.settlementMethod && exp.settlementMethod.trim()) cleaned.settlementMethod = exp.settlementMethod.trim();
    if (exp.settlementReference && exp.settlementReference.trim()) cleaned.settlementReference = exp.settlementReference.trim();
    if (exp.settlementRemarks && exp.settlementRemarks.trim()) cleaned.settlementRemarks = exp.settlementRemarks.trim();
    if (exp.refundHistory && exp.refundHistory.length > 0) {
      cleaned.refundHistory = exp.refundHistory.filter(Boolean);
    }

    return sanitizeFirestorePayload(cleaned) as EventCommitteeExpense;
  };

  // Filtered expenses with applied status and committee filters
  const filteredExpenses = centralizedExpenses.filter(exp => {
    const matchesComm = appliedExpenseCommittee === 'all' || 
      (appliedExpenseCommittee === 'Event' || appliedExpenseCommittee === 'EVENT EXPENSE'
        ? (exp.committeeId === 'EVENT_EXPENSE' || exp.committeeId === 'event' || formatCategoryLabel(exp.committeeName) === 'Event' || exp.createdScope === 'finance')
        : exp.committeeName.toLowerCase() === appliedExpenseCommittee.toLowerCase());
    
    const statusObj = getExpenseLifecycleStatus(exp);
    const matchesStatus = appliedExpenseStatus === 'all' || 
      statusObj.code === appliedExpenseStatus ||
      (appliedExpenseStatus === 'accepted' && (statusObj.code === 'approved' || statusObj.code === 'refund_pending' || statusObj.code === 'refunded' || statusObj.code === 'settled'));

    const payeeName = getExpensePayeeDisplayName(exp);
    const matchesSearch = !appliedExpenseSearch.trim() || 
      exp.description.toLowerCase().includes(appliedExpenseSearch.toLowerCase()) ||
      exp.committeeName.toLowerCase().includes(appliedExpenseSearch.toLowerCase()) ||
      payeeName.toLowerCase().includes(appliedExpenseSearch.toLowerCase()) ||
      ((exp as any).payee && (exp as any).payee.toLowerCase().includes(appliedExpenseSearch.toLowerCase())) ||
      (exp.createdBy && exp.createdBy.toLowerCase().includes(appliedExpenseSearch.toLowerCase())) ||
      (exp.paidByName && exp.paidByName.toLowerCase().includes(appliedExpenseSearch.toLowerCase())) ||
      (exp.paidByResidentId && exp.paidByResidentId.toLowerCase().includes(appliedExpenseSearch.toLowerCase())) ||
      (exp.paidByUnit && exp.paidByUnit.toLowerCase().includes(appliedExpenseSearch.toLowerCase())) ||
      (exp.rejectionReason && exp.rejectionReason.toLowerCase().includes(appliedExpenseSearch.toLowerCase()));
    
    return matchesComm && matchesStatus && matchesSearch;
  });

  // Filter Action Handlers
  const handleRunExpensesFilter = () => {
    setAppliedExpenseCommittee(draftExpenseCommittee);
    setAppliedExpenseStatus(draftExpenseStatus);
    setAppliedExpenseSearch(draftExpenseSearch);
  };

  const handleClearExpensesFilter = () => {
    setDraftExpenseCommittee('all');
    setDraftExpenseStatus('all');
    setDraftExpenseSearch('');
    setAppliedExpenseCommittee('all');
    setAppliedExpenseStatus('all');
    setAppliedExpenseSearch('');
  };

  const handleRunRefundsFilter = () => {
    setAppliedRefundFilterType(draftRefundFilterType);
    setAppliedRefundSearch(draftRefundSearch);
  };

  const handleClearRefundsFilter = () => {
    setDraftRefundFilterType('all');
    setDraftRefundSearch('');
    setAppliedRefundFilterType('all');
    setAppliedRefundSearch('');
  };

  // Filtered income registrations
  const payingRegistrations = registrations.filter(r => {
    const collected = getRegistrationCollectedAmount(r);
    return collected > 0 || r.paymentStatus === 'paid' || r.paymentStatus === 'approved' || r.paymentStatus === 'partially_paid';
  });

  const filteredIncomeRegs = payingRegistrations.filter(r => {
    if (!finSearchQuery.trim()) return true;
    const q = finSearchQuery.toLowerCase();
    return (
      (r.primaryMemberGmkId && r.primaryMemberGmkId.toLowerCase().includes(q)) ||
      (r.primaryMemberEmail && r.primaryMemberEmail.toLowerCase().includes(q)) ||
      (r.participants && r.participants.some(p => p.toLowerCase().includes(q))) ||
      (r.id && r.id.toLowerCase().includes(q))
    );
  });

  // Handlers
  const handleSaveOpeningBalance = async () => {
    const val = parseFloat(openingBalInput);
    if (isNaN(val) || val < 0) {
      setErrorMsg("Please enter a valid positive opening balance amount (OMR).");
      return;
    }
    const rounded = Math.round(val * 1000) / 1000;
    try {
      setIsFinanceSubmitting(true);
      await handleUpdateFinance({ openingBalance: rounded });
      setSuccessMsg(`✓ Opening Balance set to OMR ${rounded.toFixed(3)} successfully.`);
      setShowOpeningBalModal(false);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to update opening balance: " + err.message);
    } finally {
      setIsFinanceSubmitting(false);
    }
  };

  const handleSaveBudget = async () => {
    if (!budgetCommittee.trim()) {
      setErrorMsg("Please select or specify an allocation target.");
      return;
    }
    const amt = parseFloat(budgetAmountInput);
    if (isNaN(amt) || amt < 0) {
      setErrorMsg("Please enter a valid budget amount (OMR).");
      return;
    }
    const rounded = Math.round(amt * 1000) / 1000;
    try {
      setIsFinanceSubmitting(true);
      const updatedAllocations = {
        ...rawAllocations,
        [budgetCommittee.trim()]: rounded
      };
      await handleUpdateFinance({ budgetAllocations: updatedAllocations });
      setSuccessMsg(`✓ Budget allocation of OMR ${rounded.toFixed(3)} saved for ${budgetCommittee.trim()}.`);
      setShowBudgetModal(false);
      setBudgetCommittee('');
      setBudgetAmountInput('');
      setBudgetDescInput('');
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to save budget allocation: " + err.message);
    } finally {
      setIsFinanceSubmitting(false);
    }
  };

  const handleRemoveBudget = async (committeeName: string) => {
    const displayName = formatCategoryLabel(committeeName);
    const confirmed = await confirmAction({
      title: "Remove Budget Allocation",
      message: `Are you sure you want to remove the budget allocation for ${displayName}?`,
      severity: "danger",
      confirmText: "Remove Budget",
      cancelText: "Cancel"
    });

    if (!confirmed) {
      return;
    }
    try {
      setIsFinanceSubmitting(true);
      const updatedAllocations = { ...rawAllocations };
      delete updatedAllocations[committeeName];
      await handleUpdateFinance({ budgetAllocations: updatedAllocations });
      setSuccessMsg(`✓ Budget allocation removed for ${displayName}.`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to remove budget allocation: " + err.message);
    } finally {
      setIsFinanceSubmitting(false);
    }
  };

  const handleOpenAddExpense = () => {
    setEditingExpense(null);
    setExpenseCommittee('');
    setExpenseAmountInput('');
    setExpenseDescInput('');
    setExpenseDateInput(new Date().toISOString().split('T')[0]);
    setExpensePayeeInput('');
    setExpensePaidByType('event_treasury');
    setExpensePaidByResidentId('');
    setExpensePaidByName('');
    setExpensePaidByUnit('');
    setExpensePaidByPhone('');
    setExpensePaidByEmail('');
    setExpensePaidBySponsorId('');
    setResidentSearchTerm('');
    setShowExpenseModal(true);
  };

  const handleOpenEditExpense = (exp: EventCommitteeExpense & { committeeId: string; committeeName: string; isFinanceOwned?: boolean }) => {
    const isFin = exp.isFinanceOwned ?? isFinanceOwnedExpense(exp);
    if (!isFin) {
      setErrorMsg("Committee-owned expenses are governed by their respective committees and cannot be directly edited by Finance. Please use the review Accept / Reject controls.");
      return;
    }

    setEditingExpense(exp);
    const matchedComm = activeCommittees.find(c => c.id === exp.categoryId || c.id === exp.committeeId || c.name.toLowerCase() === exp.committeeName.toLowerCase() || c.name.toLowerCase() === (exp.categoryName || '').toLowerCase());
    setExpenseCommittee(matchedComm ? matchedComm.id : (exp.categoryId || 'EVENT_EXPENSE'));
    setExpenseAmountInput(exp.amount ? exp.amount.toString() : '');
    setExpenseDescInput(exp.description || '');
    setExpenseDateInput(exp.date || new Date().toISOString().split('T')[0]);
    setExpensePayeeInput(exp.payee || '');

    const pType = (exp.paidByType || (exp.isPersonalPayment ? 'resident' : 'event_treasury')) as 'event_treasury' | 'resident' | 'sponsor';
    const normalizedType = (pType === ('event_direct' as any) ? 'event_treasury' : pType) || 'event_treasury';
    setExpensePaidByType(normalizedType);

    setExpensePaidByResidentId(exp.paidByResidentId || '');
    setExpensePaidByName(exp.paidByName || '');
    setExpensePaidByUnit(exp.paidByUnit || '');
    setExpensePaidByPhone(exp.paidByPhone || '');
    setExpensePaidByEmail(exp.paidByEmail || '');
    setExpensePaidBySponsorId(exp.paidBySponsorId || '');
    setResidentSearchTerm('');
    setShowExpenseModal(true);
  };

  const handleSaveExpense = async () => {
    if (!expenseCommittee.trim()) {
      setErrorMsg("Please select an expense category or committee.");
      return;
    }
    if (!expenseDescInput.trim() || !expenseAmountInput.trim()) {
      setErrorMsg("Please enter both expense description and amount.");
      return;
    }
    const amt = parseFloat(expenseAmountInput);
    if (isNaN(amt) || amt <= 0) {
      setErrorMsg("Please enter a valid positive expense amount (OMR).");
      return;
    }

    const isEventExpense = expenseCommittee === 'EVENT_EXPENSE' || 
      expenseCommittee.toLowerCase() === 'event expense' || 
      expenseCommittee.toLowerCase() === 'event';

    const targetComm = isEventExpense 
      ? null 
      : activeCommittees.find(c => c.id === expenseCommittee || c.name.toLowerCase() === expenseCommittee.toLowerCase());

    const categoryId = targetComm ? targetComm.id : 'EVENT_EXPENSE';
    const categoryName = targetComm ? targetComm.name : 'Event';

    if (expensePaidByType === 'resident') {
      if (!expensePaidByName.trim() || !expensePaidByResidentId.trim()) {
        setErrorMsg("Please select the GMK Resident who paid this expense.");
        return;
      }
    } else if (expensePaidByType === 'sponsor') {
      if (!expensePaidBySponsorId || !expensePaidByName.trim()) {
        setErrorMsg("Please select a registered sponsor.");
        return;
      }
    }

    try {
      setIsFinanceSubmitting(true);
      const rounded = Math.round(amt * 1000) / 1000;

      if (editingExpense) {
        // Editing an existing finance-owned expense (or reclassifying between Event and Committee)
        const updatedExpensePayload = cleanExpensePayload({
          ...editingExpense,
          categoryId: categoryId,
          categoryName: categoryName,
          date: expenseDateInput || new Date().toISOString().split('T')[0],
          description: expenseDescInput.trim(),
          amount: rounded,
          createdScope: 'finance',
          payee: expensePayeeInput.trim() || undefined,
          paidByType: expensePaidByType,
          paidByResidentId: expensePaidByType === 'resident' ? expensePaidByResidentId : undefined,
          paidByName: (expensePaidByType === 'resident' || expensePaidByType === 'sponsor') ? expensePaidByName : undefined,
          paidByUnit: expensePaidByType === 'resident' ? expensePaidByUnit : undefined,
          paidByPhone: expensePaidByType === 'resident' ? expensePaidByPhone : undefined,
          paidByEmail: expensePaidByType === 'resident' ? expensePaidByEmail : undefined,
          paidBySponsorId: expensePaidByType === 'sponsor' ? expensePaidBySponsorId : undefined,
          lastEditedBy: profile?.email || 'finance_lead',
          lastEditedAt: new Date().toISOString()
        });

        // 1. If target is Event Level:
        if (isEventExpense) {
          const currentEventExpenses = (eventFinance?.eventExpenses || eventFinance?.expenses || []) as EventCommitteeExpense[];
          const existsInEvent = currentEventExpenses.some(e => e.id === editingExpense.id);
          const updatedEventExpenses = existsInEvent
            ? currentEventExpenses.map(e => e.id === editingExpense.id ? updatedExpensePayload : cleanExpensePayload(e))
            : [...currentEventExpenses.map(e => cleanExpensePayload(e)), updatedExpensePayload];
          await handleUpdateFinance({ eventExpenses: updatedEventExpenses });

          // Also remove from any committee where it might have resided
          for (const comm of activeCommittees) {
            if ((comm.expenses || []).some(e => e.id === editingExpense.id)) {
              const updatedCommExpenses = (comm.expenses || []).filter(e => e.id !== editingExpense.id).map(e => cleanExpensePayload(e));
              await updateDoc(doc(db, "eventCommittees", comm.id), sanitizeFirestorePayload({
                expenses: updatedCommExpenses,
                updatedAt: new Date().toISOString()
              }));
            }
          }
        } else if (targetComm) {
          // 2. If target is a Committee:
          // Remove from eventFinance if it was there
          const currentEventExpenses = (eventFinance?.eventExpenses || eventFinance?.expenses || []) as EventCommitteeExpense[];
          if (currentEventExpenses.some(e => e.id === editingExpense.id)) {
            const filteredEventExpenses = currentEventExpenses.filter(e => e.id !== editingExpense.id).map(e => cleanExpensePayload(e));
            await handleUpdateFinance({ eventExpenses: filteredEventExpenses });
          }

          // Remove from other committees if it was there
          for (const comm of activeCommittees) {
            if (comm.id !== targetComm.id && (comm.expenses || []).some(e => e.id === editingExpense.id)) {
              const updatedCommExpenses = (comm.expenses || []).filter(e => e.id !== editingExpense.id).map(e => cleanExpensePayload(e));
              await updateDoc(doc(db, "eventCommittees", comm.id), sanitizeFirestorePayload({
                expenses: updatedCommExpenses,
                updatedAt: new Date().toISOString()
              }));
            }
          }

          // Add / update in target committee
          const targetExistingExpenses = targetComm.expenses || [];
          const existsInTarget = targetExistingExpenses.some(e => e.id === editingExpense.id);
          const updatedTargetExpenses = existsInTarget
            ? targetExistingExpenses.map(e => e.id === editingExpense.id ? updatedExpensePayload : cleanExpensePayload(e))
            : [...targetExistingExpenses.map(e => cleanExpensePayload(e)), updatedExpensePayload];
          
          await updateDoc(doc(db, "eventCommittees", targetComm.id), sanitizeFirestorePayload({
            expenses: updatedTargetExpenses,
            updatedAt: new Date().toISOString()
          }));
        }

        await createAuditLog(
          'EXPENSE_UPDATED',
          profile?.email || 'finance_lead',
          'expense',
          editingExpense.id,
          `Finance updated expense '${expenseDescInput.trim()}' of OMR ${rounded.toFixed(3)} assigned to ${categoryName}.`
        );

        setSuccessMsg(`✓ Successfully updated expense record assigned to ${categoryName}.`);
      } else {
        // Adding new finance-created expense
        const newExpensePayload = cleanExpensePayload({
          id: `exp_event_${Date.now()}`,
          categoryId: categoryId,
          categoryName: categoryName,
          date: expenseDateInput || new Date().toISOString().split('T')[0],
          description: expenseDescInput.trim(),
          amount: rounded,
          financeStatus: 'accepted',
          createdScope: 'finance',
          acceptedAt: new Date().toISOString(),
          acceptedBy: profile?.email || 'finance_lead',
          createdAt: new Date().toISOString(),
          createdBy: profile?.email || 'finance_lead',
          payee: expensePayeeInput.trim() || undefined,
          paidByType: expensePaidByType,
          paidByResidentId: expensePaidByType === 'resident' ? expensePaidByResidentId : undefined,
          paidByName: (expensePaidByType === 'resident' || expensePaidByType === 'sponsor') ? expensePaidByName : undefined,
          paidByUnit: expensePaidByType === 'resident' ? expensePaidByUnit : undefined,
          paidByPhone: expensePaidByType === 'resident' ? expensePaidByPhone : undefined,
          paidByEmail: expensePaidByType === 'resident' ? expensePaidByEmail : undefined,
          paidBySponsorId: expensePaidByType === 'sponsor' ? expensePaidBySponsorId : undefined
        });

        if (isEventExpense) {
          const currentEventExpenses = (eventFinance?.eventExpenses || eventFinance?.expenses || []) as EventCommitteeExpense[];
          await handleUpdateFinance({ eventExpenses: [...currentEventExpenses.map(e => cleanExpensePayload(e)), newExpensePayload] });
        } else if (targetComm) {
          const targetExistingExpenses = targetComm.expenses || [];
          await updateDoc(doc(db, "eventCommittees", targetComm.id), sanitizeFirestorePayload({
            expenses: [...targetExistingExpenses.map(e => cleanExpensePayload(e)), newExpensePayload],
            updatedAt: new Date().toISOString()
          }));
        }

        await createAuditLog(
          'EXPENSE_CREATED',
          profile?.email || 'finance_lead',
          'expense',
          newExpensePayload.id,
          `Finance recorded expense '${expenseDescInput.trim()}' of OMR ${rounded.toFixed(3)} for ${categoryName}.`
        );

        setSuccessMsg(`✓ Recorded expense of OMR ${rounded.toFixed(3)} for ${categoryName}.`);
      }

      setShowExpenseModal(false);
      setEditingExpense(null);
      setExpenseAmountInput('');
      setExpenseDescInput('');
      setExpensePayeeInput('');
      setExpensePaidByType('event_treasury');
      setExpensePaidByResidentId('');
      setExpensePaidByName('');
      setExpensePaidByUnit('');
      setExpensePaidByPhone('');
      setExpensePaidByEmail('');
      setExpensePaidBySponsorId('');
      setResidentSearchTerm('');
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to save expense: " + err.message);
    } finally {
      setIsFinanceSubmitting(false);
    }
  };

  const handleDeleteExpense = async (
    committeeId: string, 
    expenseId: string, 
    committeeName: string,
    expObj?: EventCommitteeExpense & { isFinanceOwned?: boolean; committeeId?: string }
  ) => {
    const isFin = expObj ? (expObj.isFinanceOwned ?? isFinanceOwnedExpense(expObj)) : (committeeId === 'EVENT_EXPENSE' || committeeName === 'EVENT EXPENSE' || committeeName === 'Event');
    if (!isFin) {
      setErrorMsg("Committee-owned expenses are governed by their respective committees and cannot be deleted by Finance.");
      return;
    }

    const confirmed = await confirmAction({
      title: "Delete Expense",
      message: "Are you sure you want to delete this expense record? This action cannot be undone.",
      severity: "danger",
      confirmText: "Delete Expense",
      cancelText: "Cancel"
    });

    if (!confirmed) {
      return;
    }
    try {
      setIsFinanceSubmitting(true);
      const currentEventExpenses = (eventFinance?.eventExpenses || eventFinance?.expenses || []) as EventCommitteeExpense[];
      const existsInEventFinance = currentEventExpenses.some(e => e.id === expenseId);
      
      if (existsInEventFinance) {
        const updated = currentEventExpenses.filter(e => e.id !== expenseId);
        await handleUpdateFinance({ eventExpenses: updated });
      }

      // Check all active committees and remove if present
      for (const comm of activeCommittees) {
        if ((comm.expenses || []).some(e => e.id === expenseId)) {
          const updated = (comm.expenses || []).filter(e => e.id !== expenseId).map(e => cleanExpensePayload(e));
          await updateDoc(doc(db, "eventCommittees", comm.id), sanitizeFirestorePayload({
            expenses: updated,
            updatedAt: new Date().toISOString()
          }));
        }
      }

      await createAuditLog(
        'EXPENSE_DELETED',
        profile?.email || 'finance_lead',
        'expense',
        expenseId,
        `Finance deleted expense ${expenseId}.`
      );

      setSuccessMsg("✓ Expense removed successfully.");
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to delete expense: " + err.message);
    } finally {
      setIsFinanceSubmitting(false);
    }
  };

  const handleAcceptExpense = async (exp: EventCommitteeExpense & { committeeId: string; committeeName: string }) => {
    try {
      setIsFinanceSubmitting(true);
      const isEventExpense = exp.committeeId === 'EVENT_EXPENSE' || exp.committeeName === 'EVENT EXPENSE';
      const isReimbursable = (exp.paidByType === 'resident' || exp.paidByType === 'sponsor' || exp.isPersonalPayment);

      const targetPayableStatus = isReimbursable && exp.settlementStatus !== 'settled'
        ? 'pending'
        : (exp.payableStatus || (exp.settlementStatus === 'settled' ? 'refunded' : undefined));

      const updatedPayload: EventCommitteeExpense = cleanExpensePayload({
        ...exp,
        financeStatus: 'accepted',
        acceptedAt: new Date().toISOString(),
        acceptedBy: profile?.email || 'finance_lead',
        ...(targetPayableStatus ? { payableStatus: targetPayableStatus } : {})
      });

      if (isEventExpense) {
        const currentEventExpenses = (eventFinance?.eventExpenses || eventFinance?.expenses || []) as EventCommitteeExpense[];
        const updated = currentEventExpenses.map(e => e.id === exp.id ? updatedPayload : cleanExpensePayload(e));
        await handleUpdateFinance({ eventExpenses: updated });
      } else {
        const comm = activeCommittees.find(c => c.id === exp.committeeId);
        if (!comm) {
          setErrorMsg("Committee not found.");
          return;
        }
        const updated = (comm.expenses || []).map(e => e.id === exp.id ? updatedPayload : cleanExpensePayload(e));
        await updateDoc(doc(db, "eventCommittees", comm.id), sanitizeFirestorePayload({
          expenses: updated,
          updatedAt: new Date().toISOString()
        }));
      }

      await createAuditLog(
        'EXPENSE_ACCEPTED',
        profile?.email || 'finance_lead',
        'expense',
        exp.id,
        `Finance accepted expense '${exp.description}' of OMR ${(exp.amount || 0).toFixed(3)} from ${exp.committeeName}.`
      );

      setSuccessMsg(`✓ Expense of OMR ${(exp.amount || 0).toFixed(3)} for ${exp.committeeName} approved and accepted.`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to accept expense: " + err.message);
    } finally {
      setIsFinanceSubmitting(false);
    }
  };

  const handleRejectExpense = async () => {
    if (!rejectingExpense) return;
    if (!rejectionReasonInput.trim()) {
      setErrorMsg("Please provide a valid rejection reason.");
      return;
    }

    try {
      setIsFinanceSubmitting(true);
      const exp = rejectingExpense;
      const isEventExpense = exp.committeeId === 'EVENT_EXPENSE' || exp.committeeName === 'EVENT EXPENSE';

      const updatedPayload: EventCommitteeExpense = cleanExpensePayload({
        ...exp,
        financeStatus: 'rejected',
        rejectedAt: new Date().toISOString(),
        rejectedBy: profile?.email || 'finance_lead',
        rejectionReason: rejectionReasonInput.trim()
      });

      if (isEventExpense) {
        const currentEventExpenses = (eventFinance?.eventExpenses || eventFinance?.expenses || []) as EventCommitteeExpense[];
        const updated = currentEventExpenses.map(e => e.id === exp.id ? updatedPayload : cleanExpensePayload(e));
        await handleUpdateFinance({ eventExpenses: updated });
      } else {
        const comm = activeCommittees.find(c => c.id === exp.committeeId);
        if (!comm) {
          setErrorMsg("Committee not found.");
          return;
        }
        const updated = (comm.expenses || []).map(e => e.id === exp.id ? updatedPayload : cleanExpensePayload(e));
        await updateDoc(doc(db, "eventCommittees", comm.id), sanitizeFirestorePayload({
          expenses: updated,
          updatedAt: new Date().toISOString()
        }));
      }

      await createAuditLog(
        'EXPENSE_REJECTED',
        profile?.email || 'finance_lead',
        'expense',
        exp.id,
        `Finance rejected expense '${exp.description}' for ${exp.committeeName}. Reason: ${rejectionReasonInput.trim()}`
      );

      setSuccessMsg(`✓ Expense rejected and returned to ${exp.committeeName} for revision.`);
      setShowRejectModal(false);
      setRejectingExpense(null);
      setRejectionReasonInput('');
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to reject expense: " + err.message);
    } finally {
      setIsFinanceSubmitting(false);
    }
  };

  const handleSettlePayable = async () => {
    if (!settlingExpense) return;
    try {
      setIsFinanceSubmitting(true);
      const exp = settlingExpense;
      const isEventExpense = exp.committeeId === 'EVENT_EXPENSE' || exp.committeeName === 'EVENT EXPENSE';

      const updatedPayload: EventCommitteeExpense = cleanExpensePayload({
        ...exp,
        settlementStatus: 'settled',
        settledAt: new Date().toISOString(),
        settledBy: profile?.email || 'finance_lead',
        settlementMethod: settleMethodInput.trim() || 'Bank Transfer',
        settlementReference: settleRefInput.trim() || undefined,
        settlementRemarks: settleRemarksInput.trim() || undefined,
        payableStatus: 'refunded',
        refundedAmount: Number(exp.amount) || 0
      });

      if (isEventExpense) {
        const currentEventExpenses = (eventFinance?.eventExpenses || eventFinance?.expenses || []) as EventCommitteeExpense[];
        const updated = currentEventExpenses.map(e => e.id === exp.id ? updatedPayload : cleanExpensePayload(e));
        await handleUpdateFinance({ eventExpenses: updated });
      } else {
        const comm = activeCommittees.find(c => c.id === exp.committeeId);
        if (!comm) {
          setErrorMsg("Committee not found.");
          return;
        }
        const updated = (comm.expenses || []).map(e => e.id === exp.id ? updatedPayload : cleanExpensePayload(e));
        await updateDoc(doc(db, "eventCommittees", comm.id), sanitizeFirestorePayload({
          expenses: updated,
          updatedAt: new Date().toISOString()
        }));
      }

      await createAuditLog(
        'EXPENSE_SETTLED',
        profile?.email || 'finance_lead',
        'expense',
        exp.id,
        `Settled reimbursement of OMR ${(exp.amount || 0).toFixed(3)} to ${exp.paidByName || 'Resident'} (${exp.committeeName}).`
      );

      setSuccessMsg(`✓ Reimbursement of OMR ${(exp.amount || 0).toFixed(3)} to ${exp.paidByName || 'Payee'} marked as Settled.`);
      setShowSettleModal(false);
      setSettlingExpense(null);
      setSettleMethodInput('Bank Transfer');
      setSettleRefInput('');
      setSettleRemarksInput('');
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to settle reimbursement: " + err.message);
    } finally {
      setIsFinanceSubmitting(false);
    }
  };

  const handleProcessRefund = async (reg: EventRegistration) => {
    try {
      setIsFinanceSubmitting(true);
      const amtRec = Number(reg.amountReceived ?? (reg.paymentStatus === 'paid' ? (reg.amountDue ?? reg.paymentAmount ?? 0) : 0));
      const amtDue = Number(reg.amountDue ?? (reg.paymentStatus === 'cancelled' ? 0 : (reg.paymentAmount ?? 0)));
      const refundAmt = Number(reg.refundDue || Math.max(0, amtRec - amtDue));

      if (refundAmt <= 0) {
        setErrorMsg("No refund is due for this registration.");
        return;
      }

      // Try callable cloud function if deployed
      try {
        const processPaymentFn = httpsCallable(functions, 'processEventPayment');
        await processPaymentFn({
          registrationId: reg.id,
          amountReceived: amtDue,
          financeRemarks: `Refund of OMR ${refundAmt.toFixed(3)} processed by Finance.`
        });
      } catch (fnErr) {
        console.warn("Callable function fallback to direct Firestore update:", fnErr);
      }

      // Direct Firestore update to guarantee immediate real-time reflection
      const newStatus = reg.paymentStatus === 'cancelled' ? 'refunded' : (amtDue > 0 ? 'paid' : 'refunded');
      await updateDoc(doc(db, "event_registrations", reg.id), sanitizeFirestorePayload({
        paymentStatus: newStatus,
        refundDue: 0,
        amountReceived: amtDue,
        balanceDue: 0,
        refundedAmount: refundAmt,
        refundedAt: new Date().toISOString(),
        refundedBy: profile?.email || 'finance_lead',
        financeRemarks: `Refund of OMR ${refundAmt.toFixed(3)} processed by Finance (${profile?.email || 'Finance Lead'}).`,
        updatedAt: new Date().toISOString()
      }));

      setSuccessMsg(`✓ Refund of OMR ${refundAmt.toFixed(3)} processed successfully for ${reg.primaryMemberGmkId || reg.primaryMemberEmail}.`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to process refund: " + err.message);
    } finally {
      setIsFinanceSubmitting(false);
    }
  };

  // PDF Generators
  const generateFinancialSummaryPDF = () => {
    const doc = new jsPDF();
    const title = activeEvent?.title || 'Community Gathering';
    
    // Header
    doc.setFontSize(18);
    doc.setTextColor(15, 76, 42); // #0f4c2a
    doc.text('FINANCIAL STATEMENT & STATEMENT OF ACCOUNTS', 14, 20);
    
    doc.setFontSize(11);
    doc.setTextColor(100, 100, 100);
    doc.text(`Event: ${title}`, 14, 28);
    doc.text(`Generated Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 14, 34);

    // Summary Table
    autoTable(doc, {
      startY: 42,
      head: [['Financial Account', 'Type', 'Amount (OMR)']],
      body: [
        ['Opening Balance (Carried Forward)', 'Asset', `OMR ${openingBalance.toFixed(3)}`],
        ['Registration Income (Collected)', 'Revenue', `OMR ${totalRegistrationRec.toFixed(3)}`],
        ['Sponsorship Income', 'Revenue', `OMR ${sponsorshipIncome.toFixed(3)}`],
        ['TOTAL INCOME', 'Revenue', `OMR ${totalIncome.toFixed(3)}`],
        ['Total Operational & Event Expenses', 'Expense', `OMR ${totalExpenses.toFixed(3)}`],
        ['AVAILABLE CLOSING BALANCE', 'Net Position', `OMR ${availableBalance.toFixed(3)}`]
      ],
      theme: 'grid',
      headStyles: { fillColor: [15, 76, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 10, cellPadding: 4 }
    });

    // Committee & Event Expense Breakdown
    const eventExpensesSum = ((eventFinance?.eventExpenses || eventFinance?.expenses || []) as EventCommitteeExpense[]).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const eventBudget = allocations['EVENT EXPENSE'] || 0;

    const commRows = activeCommittees.map(c => {
      const cExpenses = (c.expenses || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      const cBudget = allocations[c.name] || 0;
      const cRemaining = Math.max(0, cBudget - cExpenses);
      const cUtil = cBudget > 0 ? ((cExpenses / cBudget) * 100).toFixed(1) + '%' : 'N/A';
      return [c.name, `OMR ${cBudget.toFixed(3)}`, `OMR ${cExpenses.toFixed(3)}`, `OMR ${cRemaining.toFixed(3)}`, cUtil];
    });

    if (eventBudget > 0 || eventExpensesSum > 0) {
      const remaining = Math.max(0, eventBudget - eventExpensesSum);
      const util = eventBudget > 0 ? ((eventExpensesSum / eventBudget) * 100).toFixed(1) + '%' : 'N/A';
      commRows.push(['Event (Event Level)', `OMR ${eventBudget.toFixed(3)}`, `OMR ${eventExpensesSum.toFixed(3)}`, `OMR ${remaining.toFixed(3)}`, util]);
    }

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 12,
      head: [['Expense Category / Committee', 'Budget Allocated', 'Actual Expenses', 'Remaining', 'Utilization']],
      body: commRows.length > 0 ? commRows : [['No expense categories configured', '-', '-', '-', '-']],
      theme: 'striped',
      headStyles: { fillColor: [50, 50, 50], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 3 }
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`Financial_Summary_${title.replace(/\s+/g, '_')}_${dateStr}.pdf`);
    setSuccessMsg("✓ Financial Summary PDF generated successfully.");
  };

  const generateCommitteeBudgetPDF = () => {
    const doc = new jsPDF();
    const title = activeEvent?.title || 'Community Gathering';
    
    doc.setFontSize(16);
    doc.setTextColor(15, 76, 42);
    doc.text('COMMITTEE BUDGET ALLOCATION & UTILIZATION REPORT', 14, 20);
    
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Event: ${title}`, 14, 28);
    doc.text(`Total Allocated: OMR ${totalBudget.toFixed(3)} | Total Spent: OMR ${totalExpenses.toFixed(3)}`, 14, 34);

    const eventExpensesSum = ((eventFinance?.eventExpenses || eventFinance?.expenses || []) as EventCommitteeExpense[]).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const rows = activeCommittees.map(c => {
      const budget = allocations[c.name] || 0;
      const spent = (c.expenses || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      const rem = budget - spent;
      const util = budget > 0 ? ((spent / budget) * 100).toFixed(1) + '%' : '0.0%';
      let status = 'On Track';
      if (budget > 0) {
        if (spent > budget) status = 'OVER BUDGET';
        else if (spent === budget) status = 'BUDGET FULL';
        else if (spent / budget >= 0.8) status = 'HIGH UTILIZATION';
      } else if (spent > 0) {
        status = 'NO BUDGET SET';
      }
      return [c.name, `OMR ${budget.toFixed(3)}`, `OMR ${spent.toFixed(3)}`, `OMR ${rem.toFixed(3)}`, util, status];
    });

    if (allocations['EVENT EXPENSE'] || allocations['Event'] || eventExpensesSum > 0) {
      const budget = allocations['Event'] || allocations['EVENT EXPENSE'] || 0;
      const spent = eventExpensesSum;
      const rem = budget - spent;
      const util = budget > 0 ? ((spent / budget) * 100).toFixed(1) + '%' : '0.0%';
      let status = 'On Track';
      if (budget > 0) {
        if (spent > budget) status = 'OVER BUDGET';
        else if (spent === budget) status = 'BUDGET FULL';
        else if (spent / budget >= 0.8) status = 'HIGH UTILIZATION';
      } else if (spent > 0) {
        status = 'NO BUDGET SET';
      }
      rows.push(['Event (Event Level)', `OMR ${budget.toFixed(3)}`, `OMR ${spent.toFixed(3)}`, `OMR ${rem.toFixed(3)}`, util, status]);
    }

    autoTable(doc, {
      startY: 42,
      head: [['Expense Category / Committee', 'Allocated Budget', 'Actual Expenses', 'Remaining', 'Utilization %', 'Status']],
      body: rows,
      theme: 'grid',
      headStyles: { fillColor: [15, 76, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 4 }
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`Committee_Budgets_${title.replace(/\s+/g, '_')}_${dateStr}.pdf`);
    setSuccessMsg("✓ Committee Budgets PDF generated successfully.");
  };

  // Robust refunds derivations
  const isRefundPending = (r: EventRegistration) => {
    if (r.paymentStatus === 'refunded') return false;
    if (r.paymentStatus === 'refund_due' || r.paymentStatus === 'overpaid') return true;
    if (r.refundDue !== undefined && r.refundDue > 0) return true;
    const amtRec = Number(r.amountReceived ?? (r.paymentStatus === 'paid' ? (r.amountDue ?? r.paymentAmount ?? 0) : 0));
    const amtDue = Number(r.amountDue ?? (r.paymentStatus === 'cancelled' ? 0 : (r.paymentAmount ?? 0)));
    if (amtRec > amtDue) return true;
    if (r.paymentStatus === 'cancelled' && amtRec > 0) return true;
    return false;
  };

  const isRefundProcessedOrResolved = (r: EventRegistration) => {
    if (isRefundPending(r)) return false;
    if (r.paymentStatus === 'refunded') return true;
    if (r.paymentStatus === 'cancelled' && (r.financeRemarks?.toLowerCase().includes('refund') || (r.refundedAmount && r.refundedAmount > 0))) return true;
    if (r.financeRemarks?.toLowerCase().includes('refund') && (r.refundDue || 0) <= 0 && r.paymentStatus !== 'refund_due' && r.paymentStatus !== 'overpaid') return true;
    return false;
  };

  const pendingRefunds = useMemo(() => {
    return registrations.filter(isRefundPending);
  }, [registrations]);

  const processedRefunds = useMemo(() => {
    return registrations.filter(isRefundProcessedOrResolved);
  }, [registrations]);

  const totalPendingRefundsAmount = useMemo(() => {
    return pendingRefunds.reduce((acc, reg) => {
      const amtRec = Number(reg.amountReceived ?? (reg.paymentStatus === 'paid' ? (reg.amountDue ?? reg.paymentAmount ?? 0) : 0));
      const amtDue = Number(reg.amountDue ?? (reg.paymentStatus === 'cancelled' ? 0 : (reg.paymentAmount ?? 0)));
      const refundAmt = reg.refundDue || Math.max(0, amtRec - amtDue);
      return acc + refundAmt;
    }, 0);
  }, [pendingRefunds]);

  const totalProcessedRefundsAmount = useMemo(() => {
    return processedRefunds.reduce((acc, reg) => {
      const amtRec = Number(reg.amountReceived ?? (reg.amountDue ?? 0));
      return acc + (reg.refundedAmount || amtRec);
    }, 0);
  }, [processedRefunds]);

  const filteredPendingPayables = useMemo(() => {
    if (!appliedRefundSearch.trim()) return pendingPayables;
    const q = appliedRefundSearch.toLowerCase();
    return pendingPayables.filter(exp => 
      exp.description.toLowerCase().includes(q) ||
      exp.committeeName.toLowerCase().includes(q) ||
      (exp.paidByName && exp.paidByName.toLowerCase().includes(q)) ||
      (exp.paidByResidentId && exp.paidByResidentId.toLowerCase().includes(q)) ||
      (exp.paidByUnit && exp.paidByUnit.toLowerCase().includes(q)) ||
      (exp.paidByPhone && exp.paidByPhone.toLowerCase().includes(q))
    );
  }, [pendingPayables, appliedRefundSearch]);

  const filteredSettledPayables = useMemo(() => {
    if (!appliedRefundSearch.trim()) return settledPayables;
    const q = appliedRefundSearch.toLowerCase();
    return settledPayables.filter(exp => 
      exp.description.toLowerCase().includes(q) ||
      exp.committeeName.toLowerCase().includes(q) ||
      (exp.paidByName && exp.paidByName.toLowerCase().includes(q)) ||
      (exp.paidByResidentId && exp.paidByResidentId.toLowerCase().includes(q)) ||
      (exp.paidByUnit && exp.paidByUnit.toLowerCase().includes(q)) ||
      (exp.settlementReference && exp.settlementReference.toLowerCase().includes(q))
    );
  }, [settledPayables, appliedRefundSearch]);

  const filteredPendingRefunds = useMemo(() => {
    if (!appliedRefundSearch.trim()) return pendingRefunds;
    const q = appliedRefundSearch.toLowerCase();
    return pendingRefunds.filter(reg => 
      (reg.primaryMemberGmkId && reg.primaryMemberGmkId.toLowerCase().includes(q)) ||
      (reg.primaryMemberEmail && reg.primaryMemberEmail.toLowerCase().includes(q)) ||
      (reg.primaryMemberName && reg.primaryMemberName.toLowerCase().includes(q)) ||
      (reg.id && reg.id.toLowerCase().includes(q))
    );
  }, [pendingRefunds, appliedRefundSearch]);

  const filteredProcessedRefunds = useMemo(() => {
    if (!appliedRefundSearch.trim()) return processedRefunds;
    const q = appliedRefundSearch.toLowerCase();
    return processedRefunds.filter(reg => 
      (reg.primaryMemberGmkId && reg.primaryMemberGmkId.toLowerCase().includes(q)) ||
      (reg.primaryMemberEmail && reg.primaryMemberEmail.toLowerCase().includes(q)) ||
      (reg.primaryMemberName && reg.primaryMemberName.toLowerCase().includes(q)) ||
      (reg.id && reg.id.toLowerCase().includes(q))
    );
  }, [processedRefunds, appliedRefundSearch]);

  // Export Centralized Expenses to PDF
  const handleExportExpensesPDF = () => {
    try {
      const doc = new jsPDF('landscape');
      const title = activeEvent?.title || 'Community Event';
      const dateStr = new Date().toISOString().slice(0, 10);
      const timestamp = new Date().toLocaleString();

      // Title & Branding Header
      doc.setFillColor(15, 76, 42); // GMK Green
      doc.rect(0, 0, 297, 24, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text("GREENS MALAYALEE KOOTTAYAMA — FINANCE CONSOLE", 14, 11);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`CENTRALIZED EXPENSES LEDGER • ${title.toUpperCase()}`, 14, 18);

      // Meta info
      doc.setTextColor(60, 60, 60);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.text(`Generated: ${timestamp} | Scope: Authorized Finance Console`, 14, 30);
      
      const filterLabel = `Filters Applied: Committee: [${appliedExpenseCommittee === 'all' ? 'All Committees' : appliedExpenseCommittee}] | Status: [${appliedExpenseStatus.toUpperCase()}] | Search: [${appliedExpenseSearch || 'None'}]`;
      doc.text(filterLabel, 14, 35);

      // Summary metrics
      const totalAmt = filteredExpenses.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
      const acceptedAmt = filteredExpenses
        .filter(e => e.financeStatus === 'accepted' || (e.isFinanceOwned && e.financeStatus !== 'rejected'))
        .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
      const pendingAmt = filteredExpenses
        .filter(e => !e.isFinanceOwned && (e.financeStatus === 'pending' || !e.financeStatus))
        .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

      doc.setFillColor(245, 247, 245);
      doc.roundedRect(14, 38, 269, 14, 2, 2, 'F');
      doc.setTextColor(15, 76, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(`Total Records: ${filteredExpenses.length}`, 18, 46);
      doc.text(`Total Filtered Sum: OMR ${totalAmt.toFixed(3)}`, 75, 46);
      doc.text(`Accepted (Budget Impact): OMR ${acceptedAmt.toFixed(3)}`, 145, 46);
      doc.text(`Pending Review: OMR ${pendingAmt.toFixed(3)}`, 220, 46);

      const rows = filteredExpenses.map(exp => {
        const isFin = exp.isFinanceOwned ?? isFinanceOwnedExpense(exp);
        const statusObj = getExpenseLifecycleStatus(exp);
        const payeeName = getExpensePayeeDisplayName(exp);

        const settlementDisplay = (exp.paidByType === 'resident' || exp.paidByType === 'sponsor' || exp.isPersonalPayment)
          ? (exp.settlementStatus === 'settled' || exp.payableStatus === 'refunded' ? `Refunded (${exp.settlementMethod || 'Bank Transfer'})` : 'Refund Pending')
          : 'Settled (Treasury)';

        return [
          exp.date || 'N/A',
          formatCategoryLabel(exp.committeeName),
          exp.description || 'N/A',
          payeeName,
          `OMR ${(Number(exp.amount) || 0).toFixed(3)}`,
          statusObj.label,
          settlementDisplay
        ];
      });

      autoTable(doc, {
        startY: 55,
        head: [['Date', 'Committee / Category', 'Description', 'Payee', 'Amount (OMR)', 'Status', 'Action / Settlement']],
        body: rows.length > 0 ? rows : [['No expenses matching current filter criteria.', '', '', '', '', '', '']],
        theme: 'grid',
        headStyles: { fillColor: [15, 76, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
        styles: { fontSize: 8, cellPadding: 3 },
        foot: rows.length > 0 ? [[
          'Total',
          '',
          '',
          `${filteredExpenses.length} Expense Records`,
          `OMR ${totalAmt.toFixed(3)}`,
          '',
          ''
        ]] : undefined,
        footStyles: { fillColor: [240, 245, 240], textColor: [15, 76, 42], fontStyle: 'bold', fontSize: 8.5 }
      });

      doc.save(`Centralized_Expenses_Ledger_${title.replace(/\s+/g, '_')}_${dateStr}.pdf`);
      setSuccessMsg("✓ Centralized Expenses Ledger PDF generated successfully.");
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to generate Expenses PDF: " + err.message);
    }
  };

  // Export Centralized Expenses to Excel
  const handleExportExpensesExcel = () => {
    try {
      const title = activeEvent?.title || 'Community Event';
      const dateStr = new Date().toISOString().slice(0, 10);
      const timestamp = new Date().toLocaleString();

      const totalAmt = filteredExpenses.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
      const acceptedAmt = filteredExpenses
        .filter(e => e.financeStatus === 'accepted' || (e.isFinanceOwned && e.financeStatus !== 'rejected'))
        .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
      const pendingAmt = filteredExpenses
        .filter(e => !e.isFinanceOwned && (e.financeStatus === 'pending' || !e.financeStatus))
        .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

      // Summary Sheet
      const summaryData = [
        ['Greens Malayalee Koottayma — Centralized Expenses Ledger'],
        ['Event Title', title],
        ['Generated Date', timestamp],
        ['Committee Filter', appliedExpenseCommittee === 'all' ? 'All Committees' : appliedExpenseCommittee],
        ['Status Filter', appliedExpenseStatus.toUpperCase()],
        ['Search Filter', appliedExpenseSearch || 'None'],
        [],
        ['Metric', 'Value'],
        ['Total Filtered Records', filteredExpenses.length],
        ['Total Filtered Amount (OMR)', totalAmt],
        ['Accepted Expenses Amount (OMR)', acceptedAmt],
        ['Pending Review Amount (OMR)', pendingAmt]
      ];

      // Ledger Rows Sheet
      const ledgerData = filteredExpenses.map(exp => {
        const isFin = exp.isFinanceOwned ?? isFinanceOwnedExpense(exp);
        const statusObj = getExpenseLifecycleStatus(exp);
        const payeeName = getExpensePayeeDisplayName(exp);
        const payeeTooltip = getExpensePayeeTooltip(exp);

        const settlementDisplay = (exp.paidByType === 'resident' || exp.paidByType === 'sponsor' || exp.isPersonalPayment)
          ? (exp.settlementStatus === 'settled' || exp.payableStatus === 'refunded' ? `Refunded (${exp.settlementMethod || 'Bank Transfer'})` : 'Refund Pending')
          : 'Settled (Treasury)';

        return {
          'Expense ID': exp.id,
          'Date': exp.date || 'N/A',
          'Committee / Category': formatCategoryLabel(exp.committeeName),
          'Description': exp.description || 'N/A',
          'Payee': payeeName,
          'Payee Details': payeeTooltip,
          'Payment Source': exp.paidByType === 'resident' ? 'Resident Out-of-Pocket' : exp.paidByType === 'sponsor' ? 'Registered Sponsor' : 'Event Treasury',
          'Payer Name': exp.paidByName || '',
          'Payer Unit': exp.paidByUnit || '',
          'Payer GMK ID': exp.paidByResidentId || '',
          'Payer Phone': exp.paidByPhone || '',
          'Amount (OMR)': Number(exp.amount) || 0,
          'Status': statusObj.label,
          'Action / Settlement': settlementDisplay,
          'Settlement Ref': exp.settlementReference || '',
          'Settlement Date': exp.settledAt || '',
          'Created By': exp.createdBy || '',
          'Created Scope': isFin ? 'Finance Workspace' : 'Committee Workspace'
        };
      });

      const wb = XLSX.utils.book_new();
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
      const wsLedger = XLSX.utils.json_to_sheet(ledgerData);

      XLSX.utils.book_append_sheet(wb, wsSummary, "SUMMARY");
      XLSX.utils.book_append_sheet(wb, wsLedger, "EXPENSES_LEDGER");

      XLSX.writeFile(wb, `Centralized_Expenses_Ledger_${title.replace(/\s+/g, '_')}_${dateStr}.xlsx`);
      setSuccessMsg("✓ Centralized Expenses Ledger Excel exported successfully.");
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to export Expenses Excel: " + err.message);
    }
  };

  // Export Refunds & Payables to PDF
  const handleExportRefundsPDF = () => {
    try {
      const doc = new jsPDF('landscape');
      const title = activeEvent?.title || 'Community Event';
      const dateStr = new Date().toISOString().slice(0, 10);
      const timestamp = new Date().toLocaleString();

      // Title & Branding Header
      doc.setFillColor(15, 76, 42); // GMK Green
      doc.rect(0, 0, 297, 24, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text("GREENS MALAYALEE KOOTTAYAMA — FINANCE CONSOLE", 14, 11);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`REFUNDS & PAYABLES REPORT • ${title.toUpperCase()}`, 14, 18);

      // Meta info
      doc.setTextColor(60, 60, 60);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.text(`Generated: ${timestamp} | Scope: Authorized Finance Console`, 14, 30);
      doc.text(`Filter View: ${appliedRefundFilterType.replace(/_/g, ' ').toUpperCase()} | Search: "${appliedRefundSearch || 'None'}"`, 14, 35);

      // Summary section
      doc.setFillColor(245, 247, 245);
      doc.roundedRect(14, 38, 269, 14, 2, 2, 'F');
      doc.setTextColor(15, 76, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text(`Pending Reimbursements: ${pendingPayables.length} (OMR ${totalPendingPayablesAmount.toFixed(3)})`, 18, 46);
      doc.text(`Settled Reimbursements: ${settledPayables.length} (OMR ${totalSettledPayablesAmount.toFixed(3)})`, 85, 46);
      doc.text(`Pending Reg Refunds: ${pendingRefunds.length} (OMR ${totalPendingRefundsAmount.toFixed(3)})`, 155, 46);
      doc.text(`Processed Reg Refunds: ${processedRefunds.length}`, 225, 46);

      const rows: any[] = [];

      // 1. Pending Payables
      if (appliedRefundFilterType === 'all' || appliedRefundFilterType === 'pending_payables') {
        filteredPendingPayables.forEach(exp => {
          rows.push([
            'Pending Reimbursement',
            `${exp.paidByName || 'Resident'}${exp.paidByResidentId ? ' • ' + exp.paidByResidentId : ''}${exp.paidByUnit ? ' (' + exp.paidByUnit + ')' : ''}`,
            formatCategoryLabel(exp.committeeName),
            exp.description || 'Expense Reimbursement',
            `OMR ${(Number(exp.amount) || 0).toFixed(3)}`,
            'Pending Settlement',
            exp.paidByPhone ? `Phone: ${exp.paidByPhone}` : 'N/A'
          ]);
        });
      }

      // 2. Settled Payables
      if (appliedRefundFilterType === 'all' || appliedRefundFilterType === 'settled_payables') {
        filteredSettledPayables.forEach(exp => {
          rows.push([
            'Settled Reimbursement',
            `${exp.paidByName || 'Resident'}${exp.paidByResidentId ? ' • ' + exp.paidByResidentId : ''}${exp.paidByUnit ? ' (' + exp.paidByUnit + ')' : ''}`,
            formatCategoryLabel(exp.committeeName),
            exp.description || 'Expense Reimbursement',
            `OMR ${(Number(exp.amount) || 0).toFixed(3)}`,
            'Settled',
            `Method: ${exp.settlementMethod || 'Bank'}${exp.settlementReference ? ' | Ref: ' + exp.settlementReference : ''}${exp.settledAt ? ' | ' + new Date(exp.settledAt).toLocaleDateString() : ''}`
          ]);
        });
      }

      // 3. Pending Registration Refunds
      if (appliedRefundFilterType === 'all' || appliedRefundFilterType === 'pending_refunds') {
        filteredPendingRefunds.forEach(reg => {
          const amtRec = Number(reg.amountReceived ?? (reg.paymentStatus === 'paid' ? (reg.amountDue ?? reg.paymentAmount ?? 0) : 0));
          const amtDue = Number(reg.amountDue ?? (reg.paymentStatus === 'cancelled' ? 0 : (reg.paymentAmount ?? 0)));
          const refundAmt = reg.refundDue || Math.max(0, amtRec - amtDue);

          rows.push([
            'Pending Reg Refund',
            `${reg.primaryMemberName || reg.primaryMemberGmkId || 'Resident'} (${reg.primaryMemberEmail || 'N/A'})`,
            'Registration Desk',
            `Paid OMR ${amtRec.toFixed(3)} vs Due OMR ${amtDue.toFixed(3)} (Status: ${reg.paymentStatus})`,
            `OMR ${refundAmt.toFixed(3)}`,
            'Refund Action Due',
            reg.paymentReference ? `Orig Ref: ${reg.paymentReference}` : 'N/A'
          ]);
        });
      }

      // 4. Processed Registration Refunds
      if (appliedRefundFilterType === 'all' || appliedRefundFilterType === 'processed_refunds') {
        filteredProcessedRefunds.forEach(reg => {
          const amtRec = Number(reg.amountReceived ?? (reg.amountDue ?? 0));
          rows.push([
            'Processed Reg Refund',
            `${reg.primaryMemberName || reg.primaryMemberGmkId || 'Resident'} (${reg.primaryMemberEmail || 'N/A'})`,
            'Registration Desk',
            `Resolved / Status: ${reg.paymentStatus}`,
            `OMR ${(reg.refundedAmount || amtRec).toFixed(3)}`,
            'Processed / Closed',
            reg.financeRemarks || 'Refund resolved'
          ]);
        });
      }

      autoTable(doc, {
        startY: 55,
        head: [['Obligation Type', 'Beneficiary / Payee', 'Originating Scope', 'Description / Details', 'Amount (OMR)', 'Status', 'Settlement Reference / Date']],
        body: rows.length > 0 ? rows : [['No records matching current filter criteria.', '', '', '', '', '', '']],
        theme: 'grid',
        headStyles: { fillColor: [15, 76, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        styles: { fontSize: 7.5, cellPadding: 2.5 }
      });

      doc.save(`Refunds_and_Payables_Report_${title.replace(/\s+/g, '_')}_${dateStr}.pdf`);
      setSuccessMsg("✓ Refunds & Payables PDF generated successfully.");
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to generate Refunds PDF: " + err.message);
    }
  };

  // Export Refunds & Payables to Excel
  const handleExportRefundsExcel = () => {
    try {
      const title = activeEvent?.title || 'Community Event';
      const dateStr = new Date().toISOString().slice(0, 10);
      const timestamp = new Date().toLocaleString();

      // Summary Data
      const summaryData = [
        ['Greens Malayalee Koottayma — Refunds & Payables Report'],
        ['Event Title', title],
        ['Generated Date', timestamp],
        ['Filter Type', appliedRefundFilterType.replace(/_/g, ' ').toUpperCase()],
        ['Search Query', appliedRefundSearch || 'None'],
        [],
        ['Obligation Category', 'Item Count', 'Total Amount (OMR)'],
        ['Pending Committee Payables (Reimbursements)', pendingPayables.length, totalPendingPayablesAmount],
        ['Settled Committee Payables (Reimbursements)', settledPayables.length, totalSettledPayablesAmount],
        ['Pending Registration Refunds', pendingRefunds.length, totalPendingRefundsAmount],
        ['Processed Registration Refunds', processedRefunds.length, totalProcessedRefundsAmount]
      ];

      // Payables Data
      const payablesData = acceptedNonTreasuryExpenses.map(exp => ({
        'Expense ID': exp.id,
        'Committee / Scope': formatCategoryLabel(exp.committeeName),
        'Description': exp.description || '',
        'Payee Name': exp.paidByName || 'Resident',
        'Payee GMK ID': exp.paidByResidentId || '',
        'Payee Unit': exp.paidByUnit || '',
        'Payee Phone': exp.paidByPhone || '',
        'Amount Due (OMR)': Number(exp.amount) || 0,
        'Settlement Status': exp.settlementStatus === 'settled' ? 'Settled' : 'Pending Settlement',
        'Settlement Method': exp.settlementMethod || '',
        'Settlement Reference': exp.settlementReference || '',
        'Settlement Remarks': exp.settlementRemarks || '',
        'Settled At': exp.settledAt || '',
        'Settled By': exp.settledBy || ''
      }));

      // Registration Refunds Data
      const refundsData = [...pendingRefunds, ...processedRefunds].map(reg => {
        const amtRec = Number(reg.amountReceived ?? (reg.paymentStatus === 'paid' ? (reg.amountDue ?? reg.paymentAmount ?? 0) : 0));
        const amtDue = Number(reg.amountDue ?? (reg.paymentStatus === 'cancelled' ? 0 : (reg.paymentAmount ?? 0)));
        const refundAmt = reg.refundDue || Math.max(0, amtRec - amtDue);

        return {
          'Registration ID': reg.id,
          'GMK ID': reg.primaryMemberGmkId || '',
          'Resident Name': reg.primaryMemberName || '',
          'Email': reg.primaryMemberEmail || '',
          'Payment Status': reg.paymentStatus || '',
          'Amount Received (OMR)': amtRec,
          'Amount Due (OMR)': amtDue,
          'Refund Due (OMR)': reg.paymentStatus === 'refunded' ? (reg.refundedAmount || amtRec) : refundAmt,
          'Refund Processed': reg.paymentStatus === 'refunded' ? 'Yes' : 'No',
          'Payment Reference': reg.paymentReference || '',
          'Finance Remarks': reg.financeRemarks || ''
        };
      });

      const wb = XLSX.utils.book_new();
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
      const wsPayables = XLSX.utils.json_to_sheet(payablesData);
      const wsRefunds = XLSX.utils.json_to_sheet(refundsData);

      XLSX.utils.book_append_sheet(wb, wsSummary, "SUMMARY");
      XLSX.utils.book_append_sheet(wb, wsPayables, "PAYABLES_REIMBURSEMENTS");
      XLSX.utils.book_append_sheet(wb, wsRefunds, "REGISTRATION_REFUNDS");

      XLSX.writeFile(wb, `Refunds_and_Payables_Report_${title.replace(/\s+/g, '_')}_${dateStr}.xlsx`);
      setSuccessMsg("✓ Refunds & Payables Excel exported successfully.");
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to export Refunds Excel: " + err.message);
    }
  };

  if (!isFinanceAuth) {
    return (
      <div className="p-8 text-center text-stone-500 font-bold bg-white rounded-2xl border border-stone-200 shadow-sm animate-fadeIn">
        <AlertCircle className="w-8 h-8 mx-auto mb-3 text-rose-500" />
        <p>Access Denied.</p>
        <p className="text-xs mt-1">You must be assigned as a Finance Lead or Event Director to access this workspace.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl shadow-sm flex flex-col animate-fadeIn overflow-hidden h-full">
      {/* Workspace Header */}
      <div className="bg-[#0f4c2a] text-white p-4 sm:p-5 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-[#d4af37]/20 rounded-xl flex items-center justify-center">
            <PieChart className="w-5 h-5 text-[#d4af37]" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black uppercase tracking-widest font-heading">Finance Workspace</h2>
            <p className="text-[10px] sm:text-xs text-emerald-200 font-bold">{activeEvent?.title || 'No active event'}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-emerald-800/60 text-emerald-100 border border-emerald-700/50">
            <ShieldCheck className="w-3 h-3 mr-1 text-[#d4af37]" />
            Authorized Finance Console
          </span>
        </div>
      </div>
      
      {/* Finance Navigation Tabs (Desktop & Mobile Touch-Friendly Scrollable) */}
      <div className="bg-stone-50 border-b border-stone-200 overflow-x-auto hide-scrollbar shrink-0">
        <div className="flex space-x-1 p-2 min-w-max">
          {[
            { id: 'summary', label: 'Dashboard', icon: TrendingUp },
            { id: 'events', label: 'Events', icon: Calendar },
            { id: 'income', label: 'Income', icon: ArrowDownCircle },
            { id: 'budgets', label: 'Budgets', icon: PieChart },
            { id: 'expenses', label: 'Expenses', icon: CreditCard },
            { 
              id: 'refunds', 
              label: 'Refunds & Payables', 
              icon: AlertCircle,
              badgeCount: (pendingRefunds.length + pendingPayables.length)
            },
            { id: 'reports', label: 'Reports', icon: FileText }
          ].map(tab => {
            const Icon = tab.icon;
            const isSel = financeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setFinanceTab(tab.id as any);
                  setFinSearchQuery('');
                }}
                className={`px-3.5 sm:px-4 py-2 text-[10px] sm:text-xs font-black uppercase tracking-wider rounded-xl flex items-center space-x-1.5 transition-all cursor-pointer ${
                  isSel 
                    ? 'bg-[#0f4c2a] text-white shadow-sm' 
                    : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isSel ? 'text-[#d4af37]' : 'text-stone-400'}`} />
                <span>{tab.label}</span>
                {Boolean(tab.badgeCount && tab.badgeCount > 0) && (
                  <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-black ${
                    isSel ? 'bg-[#d4af37] text-stone-900' : 'bg-amber-100 text-amber-900 border border-amber-300'
                  }`}>
                    {tab.badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#fafaf9]">
        
        {/* ========================================================================= */}
        {/* 1. DASHBOARD TAB */}
        {/* ========================================================================= */}
        {financeTab === 'summary' && (
          <div className="space-y-6">
            {/* Top 4 Real-time Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              
              {/* Card 1: Opening Balance */}
              <div className="p-5 bg-white border border-stone-200 rounded-2xl shadow-xs relative flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] uppercase font-black text-stone-500 tracking-widest block">Opening Balance</span>
                    <button
                      onClick={() => {
                        setOpeningBalInput(openingBalance.toString());
                        setShowOpeningBalModal(true);
                      }}
                      className="p-1.5 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-lg transition-colors cursor-pointer flex items-center space-x-1 text-[9px] font-black uppercase tracking-wider"
                      title="Configure Opening Balance"
                    >
                      <Settings className="w-3 h-3 text-[#0f4c2a]" />
                      <span>Set</span>
                    </button>
                  </div>
                  <span className="text-2xl font-black font-mono text-stone-900 block">OMR {openingBalance.toFixed(3)}</span>
                </div>
                <p className="text-[10px] text-stone-400 font-bold mt-2">Carried forward from previous year</p>
              </div>

              {/* Card 2: Registration Income */}
              <div className="p-5 bg-emerald-50/70 border border-emerald-200 rounded-2xl shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] uppercase font-black text-emerald-800 tracking-widest block">Registration Income</span>
                    <span className="text-[9px] font-black uppercase bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">{payingRegistrationsCount} Paid</span>
                  </div>
                  <span className="text-2xl font-black font-mono text-[#0f4c2a] block">OMR {totalRegistrationRec.toFixed(3)}</span>
                </div>
                <p className="text-[10px] text-emerald-700/80 font-bold mt-2">Collected from confirmed payments</p>
              </div>

              {/* Card 3: Sponsorship Income */}
              <div className="p-5 bg-blue-50/70 border border-blue-200 rounded-2xl shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] uppercase font-black text-blue-800 tracking-widest block">Sponsorships</span>
                    <span className="text-[9px] font-black uppercase bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">{sponsorshipIncomeList.length} Sponsors</span>
                  </div>
                  <span className="text-2xl font-black font-mono text-blue-700 block">OMR {sponsorshipIncome.toFixed(3)}</span>
                </div>
                <p className="text-[10px] text-blue-700/80 font-bold mt-2">Supplied by Sponsorship Committee</p>
              </div>

              {/* Card 4: Total Expenses */}
              <div className="p-5 bg-rose-50/70 border border-rose-200 rounded-2xl shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] uppercase font-black text-rose-800 tracking-widest block">Total Expenses</span>
                    <span className="text-[9px] font-black uppercase bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full">{centralizedExpenses.length} Records</span>
                  </div>
                  <span className="text-2xl font-black font-mono text-rose-700 block">OMR {totalExpenses.toFixed(3)}</span>
                </div>
                <p className="text-[10px] text-rose-700/80 font-bold mt-2">Aggregated across all committees</p>
              </div>
            </div>
            
            {/* Total Income & Available Balance Banners */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="p-6 bg-amber-50/80 border border-amber-200 rounded-2xl shadow-xs flex flex-col justify-between">
                <div>
                  <span className="text-[10px] uppercase font-black text-amber-900 tracking-widest block mb-1">Total Income</span>
                  <p className="text-[10px] text-amber-800 font-bold mb-2">Registration Income + Sponsorship Income</p>
                  <span className="text-3xl font-black font-mono text-amber-900 block">OMR {totalIncome.toFixed(3)}</span>
                </div>
                <div className="mt-3 pt-3 border-t border-amber-200/60 text-[10px] text-amber-800 flex justify-between font-bold">
                  <span>Reg: OMR {totalRegistrationRec.toFixed(3)}</span>
                  <span>Sponsor: OMR {sponsorshipIncome.toFixed(3)}</span>
                </div>
              </div>

              <div className="lg:col-span-2 p-6 bg-indigo-50/80 border border-indigo-200 rounded-2xl shadow-xs flex flex-col justify-between">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] uppercase font-black text-indigo-900 tracking-widest block mb-1">Available Balance</span>
                    <p className="text-[10px] text-indigo-800/90 font-bold">Opening Balance + Total Income - Total Expenses</p>
                  </div>
                  <span className="text-3xl sm:text-4xl font-black font-mono text-indigo-800 block">OMR {availableBalance.toFixed(3)}</span>
                </div>
                <div className="mt-4 pt-3 border-t border-indigo-200/60 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-indigo-900 font-bold">
                  <div>Opening: <span className="font-mono font-black">OMR {openingBalance.toFixed(3)}</span></div>
                  <div>Income: <span className="font-mono font-black">OMR {totalIncome.toFixed(3)}</span></div>
                  <div>Expenses: <span className="font-mono font-black">OMR {totalExpenses.toFixed(3)}</span></div>
                  <div className="text-indigo-950 font-black">Net: <span className="font-mono">OMR {availableBalance.toFixed(3)}</span></div>
                </div>
              </div>
            </div>

            {/* Budget Utilization Summary Card */}
            <div className="p-5 bg-white border border-stone-200 rounded-2xl shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <h6 className="font-black text-stone-900 text-xs sm:text-sm uppercase tracking-wider">Committee Budget Utilization Summary</h6>
                <button
                  onClick={() => setFinanceTab('budgets')}
                  className="text-[10px] font-black text-[#0f4c2a] uppercase tracking-wider hover:underline flex items-center space-x-1"
                >
                  <span>Manage Budgets</span>
                </button>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
                <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-center">
                  <span className="block text-[9px] sm:text-[10px] font-black uppercase text-stone-500 mb-1">Allocated Budget</span>
                  <span className="font-mono font-black text-stone-800 text-xs sm:text-sm">OMR {totalBudget.toFixed(3)}</span>
                </div>
                <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-center">
                  <span className="block text-[9px] sm:text-[10px] font-black uppercase text-stone-500 mb-1">Actual Expenses</span>
                  <span className="font-mono font-black text-rose-700 text-xs sm:text-sm">OMR {totalExpenses.toFixed(3)}</span>
                </div>
                <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-center">
                  <span className="block text-[9px] sm:text-[10px] font-black uppercase text-stone-500 mb-1">Remaining</span>
                  <span className="font-mono font-black text-emerald-700 text-xs sm:text-sm">OMR {Math.max(0, totalBudget - totalExpenses).toFixed(3)}</span>
                </div>
                <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-center">
                  <span className="block text-[9px] sm:text-[10px] font-black uppercase text-stone-500 mb-1">Overall Utilization</span>
                  <span className={`font-mono font-black text-xs sm:text-sm ${
                    totalBudget > 0 && totalExpenses > totalBudget ? 'text-rose-600' : 'text-stone-800'
                  }`}>
                    {totalBudget > 0 ? ((totalExpenses / totalBudget) * 100).toFixed(1) : '0.0'}%
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-stone-100 rounded-full h-2.5 overflow-hidden">
                <div 
                  className={`h-full transition-all duration-300 ${
                    totalBudget === 0 ? 'bg-stone-300 w-0' :
                    (totalExpenses / totalBudget) > 1 ? 'bg-rose-500 w-full' :
                    (totalExpenses / totalBudget) >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: totalBudget > 0 ? `${Math.min(100, (totalExpenses / totalBudget) * 100)}%` : '0%' }}
                />
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 2. EVENTS TAB */}
        {/* ========================================================================= */}
        {financeTab === 'events' && (
          <div className="space-y-4">
            <h3 className="font-black text-[#0f4c2a] uppercase tracking-wider mb-2">Registration & Events Reporting</h3>
            <RegistrationReportingWorkspace 
              events={events}
              registrations={registrations}
              families={families}
              familyMembers={familyMembers}
              activeEvent={activeEvent}
              setPaymentModalReg={setPaymentModalReg}
              isSubmitting={isSubmitting}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* 3. INCOME TAB */}
        {/* ========================================================================= */}
        {financeTab === 'income' && (
          <div className="space-y-6">
            {/* Top Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-5 bg-emerald-50/80 border border-emerald-200 rounded-2xl shadow-xs">
                <span className="text-[10px] uppercase font-black text-emerald-800 tracking-widest block mb-1">Registration Income</span>
                <span className="text-2xl font-black font-mono text-[#0f4c2a] block mb-1">OMR {totalRegistrationRec.toFixed(3)}</span>
                <p className="text-[10px] text-emerald-700/80 font-bold">{payingRegistrationsCount} confirmed paying records</p>
              </div>

              <div className="p-5 bg-blue-50/80 border border-blue-200 rounded-2xl shadow-xs">
                <span className="text-[10px] uppercase font-black text-blue-800 tracking-widest block mb-1">Sponsorship Income</span>
                <span className="text-2xl font-black font-mono text-blue-700 block mb-1">OMR {sponsorshipIncome.toFixed(3)}</span>
                <p className="text-[10px] text-blue-700/80 font-bold">{sponsorshipIncomeList.length} recorded contributions</p>
              </div>

              <div className="p-5 bg-amber-50/80 border border-amber-200 rounded-2xl shadow-xs">
                <span className="text-[10px] uppercase font-black text-amber-900 tracking-widest block mb-1">Total Income</span>
                <span className="text-2xl font-black font-mono text-amber-900 block mb-1">OMR {totalIncome.toFixed(3)}</span>
                <p className="text-[10px] text-amber-800 font-bold">Registration + Sponsorship</p>
              </div>
            </div>
            
            {/* Section A: Registration Income Summary */}
            <div className="p-5 bg-white border border-stone-200 rounded-2xl shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-stone-150 pb-3">
                <div>
                  <h4 className="font-black text-[#0f4c2a] uppercase tracking-wider text-sm">Registration Income</h4>
                  <p className="text-stone-500 text-[10px] font-bold">Summary of collected registration payments.</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <span className="text-[10px] uppercase font-black text-emerald-800 tracking-widest block mb-1">Total Collected Registration Income</span>
                    <span className="text-lg font-black font-mono text-emerald-700">OMR {totalRegistrationRec.toFixed(3)}</span>
                  </div>
                  <div className="p-4 bg-stone-50 border border-stone-200 rounded-xl">
                    <span className="text-[10px] uppercase font-black text-stone-500 tracking-widest block mb-1">Number of Confirmed/Paying Records</span>
                    <span className="text-lg font-black font-mono text-stone-800">{payingRegistrationsCount}</span>
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setIsRegistrationModalOpen(true)}
                    className="px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-[10px] uppercase tracking-wider rounded-lg transition-all cursor-pointer"
                  >
                    VIEW REGISTRATION DETAILS
                  </button>
                </div>
              </div>
            </div>

            {/* Section B: Sponsorship Income (Read-Only) */}
            <div className="p-5 bg-white border border-stone-200 rounded-2xl shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-stone-150 pb-3">
                <div>
                  <h4 className="font-black text-blue-900 uppercase tracking-wider text-sm">Sponsorship Income</h4>
                  <p className="text-stone-500 text-[10px] font-bold">Contributions recorded by the Sponsorship Committee (Read-only).</p>
                </div>
              </div>

              {sponsorshipIncomeList.length === 0 ? (
                <div className="text-center py-10 bg-stone-50 rounded-xl border border-dashed border-stone-200">
                  <DollarSign className="w-8 h-8 text-stone-300 mx-auto mb-2" />
                  <p className="text-stone-600 font-black text-xs uppercase tracking-wider">No Sponsorship Income Recorded</p>
                  <p className="text-[10px] text-stone-400 font-bold mt-1">
                    Sponsorship contributions will be displayed here once confirmed by the Sponsorship Committee.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-4 bg-stone-50 border border-stone-200 rounded-xl">
                      <span className="text-[10px] uppercase font-black text-stone-500 tracking-widest block mb-1">Total Assured</span>
                      <span className="text-lg font-black font-mono text-stone-800">OMR {sponsorshipAssuredAmount.toFixed(3)}</span>
                    </div>
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                      <span className="text-[10px] uppercase font-black text-blue-800 tracking-widest block mb-1">Total Received</span>
                      <span className="text-lg font-black font-mono text-blue-700">OMR {sponsorshipIncome.toFixed(3)}</span>
                    </div>
                    <div className="p-4 bg-stone-50 border border-stone-200 rounded-xl">
                      <span className="text-[10px] uppercase font-black text-stone-500 tracking-widest block mb-1">Number of Contributions</span>
                      <span className="text-lg font-black font-mono text-stone-800">{sponsorshipIncomeList.length}</span>
                    </div>
                  </div>
                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => setIsSponsorshipModalOpen(true)}
                      className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-black text-[10px] uppercase tracking-wider rounded-lg transition-all cursor-pointer"
                    >
                      VIEW SPONSORSHIP DETAILS
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 4. BUDGETS TAB */}
        {/* ========================================================================= */}
        {financeTab === 'budgets' && (
          <div className="space-y-6">
            {/* Header & Allocation Trigger */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
              <div>
                <h3 className="font-black text-stone-900 uppercase tracking-wider text-sm">Committee Budget Management</h3>
                <p className="text-xs text-stone-500 font-bold mt-0.5">Allocate and monitor operational budgets for gathering committees.</p>
              </div>

              <button
                onClick={() => {
                  setBudgetCommittee(activeCommittees[0]?.name || '');
                  setBudgetAmountInput('');
                  setBudgetDescInput('');
                  setShowBudgetModal(true);
                }}
                className="px-4 py-2.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center space-x-1.5 shadow-sm"
              >
                <Plus className="w-4 h-4 text-[#d4af37]" />
                <span>Allocate Budget</span>
              </button>
            </div>

            {/* Top 4 Budget Metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="p-4 bg-white rounded-2xl border border-stone-200 shadow-xs text-center">
                <span className="block text-[9px] sm:text-[10px] font-black uppercase text-stone-500 mb-1">Total Allocated</span>
                <span className="font-mono font-black text-stone-900 text-sm sm:text-base">OMR {totalBudget.toFixed(3)}</span>
              </div>
              <div className="p-4 bg-white rounded-2xl border border-stone-200 shadow-xs text-center">
                <span className="block text-[9px] sm:text-[10px] font-black uppercase text-stone-500 mb-1">Actual Expenses</span>
                <span className="font-mono font-black text-rose-700 text-sm sm:text-base">OMR {totalExpenses.toFixed(3)}</span>
              </div>
              <div className="p-4 bg-white rounded-2xl border border-stone-200 shadow-xs text-center">
                <span className="block text-[9px] sm:text-[10px] font-black uppercase text-stone-500 mb-1">Remaining Budget</span>
                <span className="font-mono font-black text-emerald-700 text-sm sm:text-base">OMR {Math.max(0, totalBudget - totalExpenses).toFixed(3)}</span>
              </div>
              <div className="p-4 bg-white rounded-2xl border border-stone-200 shadow-xs text-center">
                <span className="block text-[9px] sm:text-[10px] font-black uppercase text-stone-500 mb-1">Overall Utilization</span>
                <span className={`font-mono font-black text-sm sm:text-base ${
                  totalBudget > 0 && totalExpenses > totalBudget ? 'text-rose-600' : 'text-stone-800'
                }`}>
                  {totalBudget > 0 ? ((totalExpenses / totalBudget) * 100).toFixed(1) : '0.0'}%
                </span>
              </div>
            </div>

            {/* Committee Budgets List / Table */}
            {Object.keys(allocations).length === 0 ? (
              <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-stone-300 p-6 space-y-3">
                <PieChart className="w-10 h-10 text-stone-300 mx-auto" />
                <h4 className="font-black text-stone-800 text-sm uppercase tracking-wider">No Committee Budgets Created</h4>
                <p className="text-stone-500 text-xs font-bold max-w-md mx-auto">
                  Assign financial budgets to operational committees or event-level categories to track real-time utilization.
                </p>
                <button
                  onClick={() => {
                    setBudgetCommittee(activeCommittees[0]?.name || 'EVENT EXPENSE');
                    setBudgetAmountInput('');
                    setBudgetDescInput('');
                    setShowBudgetModal(true);
                  }}
                  className="mt-2 px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all inline-flex items-center space-x-1.5 shadow-sm cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-[#d4af37]" />
                  <span>Allocate Budget</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(allocations).map(([commName, budgetAmount]) => {
                    const isEventExp = commName === 'EVENT EXPENSE';
                    const matchedComm = activeCommittees.find(c => c.name.toLowerCase() === commName.toLowerCase());
                    const commExpenses = isEventExp
                      ? ((eventFinance?.eventExpenses || eventFinance?.expenses || []) as EventCommitteeExpense[]).reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
                      : (matchedComm?.expenses || []).reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
                    const remaining = budgetAmount - commExpenses;
                    const utilPercent = budgetAmount > 0 ? (commExpenses / budgetAmount) * 100 : 0;

                    // Warning Status Logic:
                    // < 80%: Normal
                    // >= 80% and < 100%: WARNING — BUDGET UTILIZATION HIGH
                    // == 100%: BUDGET FULL
                    // > 100%: OVER BUDGET
                    let statusLabel = 'ON TRACK';
                    let statusBadgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
                    let progressBarClass = 'bg-emerald-500';

                    if (utilPercent > 100) {
                      statusLabel = 'OVER BUDGET';
                      statusBadgeClass = 'bg-rose-100 text-rose-800 border-rose-200 animate-pulse';
                      progressBarClass = 'bg-rose-500';
                    } else if (utilPercent === 100) {
                      statusLabel = 'BUDGET FULL';
                      statusBadgeClass = 'bg-orange-100 text-orange-800 border-orange-200';
                      progressBarClass = 'bg-orange-500';
                    } else if (utilPercent >= 80) {
                      statusLabel = 'WARNING — BUDGET UTILIZATION HIGH';
                      statusBadgeClass = 'bg-amber-100 text-amber-800 border-amber-200';
                      progressBarClass = 'bg-amber-500';
                    }

                    return (
                      <div key={commName} className="p-5 bg-white border border-stone-200 rounded-2xl shadow-xs space-y-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="text-[10px] uppercase font-black tracking-wider text-stone-400 block">
                              {isEventExp ? 'Event Level Allocation' : 'Committee'}
                            </span>
                            <h5 className="font-black text-stone-900 text-base">{formatCategoryLabel(commName)}</h5>
                          </div>
                          
                          <div className="flex items-center space-x-1.5">
                            <button
                              onClick={() => {
                                setBudgetCommittee(commName);
                                setBudgetAmountInput(budgetAmount.toString());
                                setShowBudgetModal(true);
                              }}
                              className="p-1.5 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-lg text-xs cursor-pointer"
                              title="Edit Budget"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleRemoveBudget(commName)}
                              className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-xs cursor-pointer"
                              title="Remove Allocation"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Status Warning Badge */}
                        <div className="flex items-center justify-between">
                          <span className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-wider border ${statusBadgeClass}`}>
                            {statusLabel}
                          </span>
                          <span className="font-mono text-xs font-black text-stone-700">
                            {utilPercent.toFixed(1)}% Used
                          </span>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full bg-stone-100 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${progressBarClass}`}
                            style={{ width: `${Math.min(100, utilPercent)}%` }}
                          />
                        </div>

                        {/* Numbers Grid */}
                        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-stone-100 text-[10px]">
                          <div>
                            <span className="text-stone-400 block uppercase font-black">Budget</span>
                            <span className="font-mono font-black text-stone-900 text-xs">OMR {budgetAmount.toFixed(3)}</span>
                          </div>
                          <div>
                            <span className="text-stone-400 block uppercase font-black">Actual</span>
                            <span className="font-mono font-black text-rose-700 text-xs">OMR {commExpenses.toFixed(3)}</span>
                          </div>
                          <div>
                            <span className="text-stone-400 block uppercase font-black">Remaining</span>
                            <span className={`font-mono font-black text-xs ${remaining < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                              OMR {remaining.toFixed(3)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* 5. EXPENSES TAB */}
        {/* ========================================================================= */}
        {financeTab === 'expenses' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
              <div>
                <h3 className="font-black text-stone-900 uppercase tracking-wider text-sm">Centralized Expense Ledger</h3>
                <p className="text-xs text-stone-500 font-bold mt-0.5">Uniform expense governance, review, and approval across all operational committees.</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleOpenAddExpense}
                  className="cursor-pointer px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center space-x-1.5 shadow-sm"
                >
                  <Plus className="w-4 h-4 text-[#d4af37]" />
                  <span>Enter Expense</span>
                </button>
              </div>
            </div>

            {/* Filter & Search Bar with Compact RUN Action */}
            <div className="bg-stone-100/80 p-3 rounded-2xl border border-stone-200">
              <div className="flex flex-col md:flex-row items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                  <div className="flex items-center space-x-1.5">
                    <span className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Committee:</span>
                    <select
                      value={draftExpenseCommittee}
                      onChange={(e) => setDraftExpenseCommittee(e.target.value)}
                      className="bg-white border border-stone-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-stone-800 focus:outline-none focus:border-[#0f4c2a]"
                    >
                      <option value="all">All Committees & Categories</option>
                      <option value="Event">Event (Event Level)</option>
                      {activeCommittees.map(c => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <span className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Status:</span>
                    <select
                      value={draftExpenseStatus}
                      onChange={(e) => setDraftExpenseStatus(e.target.value as any)}
                      className="bg-white border border-stone-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-stone-800 focus:outline-none focus:border-[#0f4c2a]"
                    >
                      <option value="all">All Statuses</option>
                      <option value="pending">Pending Review</option>
                      <option value="approved">Approved</option>
                      <option value="refund_pending">Refund Pending</option>
                      <option value="refunded">Refunded</option>
                      <option value="settled">Settled</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleRunExpensesFilter}
                    className="cursor-pointer px-3 py-1.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-[10px] uppercase tracking-wider rounded-xl transition-all shadow-2xs flex items-center space-x-1.5 shrink-0"
                    title="Apply Filters"
                  >
                    <Play className="w-3 h-3 text-[#d4af37] fill-[#d4af37]" />
                    <span>RUN</span>
                  </button>

                  {(draftExpenseCommittee !== 'all' || draftExpenseStatus !== 'all' || draftExpenseSearch.trim() !== '' || appliedExpenseCommittee !== 'all' || appliedExpenseStatus !== 'all' || appliedExpenseSearch.trim() !== '') && (
                    <button
                      type="button"
                      onClick={handleClearExpensesFilter}
                      className="cursor-pointer px-2.5 py-1.5 bg-stone-800 hover:bg-stone-900 text-white font-bold text-[10px] rounded-xl flex items-center gap-1 transition-colors shadow-xs"
                      title="Clear All Filters"
                    >
                      <X className="w-3 h-3" />
                      <span>Clear All</span>
                    </button>
                  )}
                </div>

                <div className="relative w-full md:w-60">
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={draftExpenseSearch}
                    onChange={(e) => setDraftExpenseSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRunExpensesFilter(); }}
                    placeholder="Filter description, payer..."
                    className="w-full pl-8 pr-3 py-1.5 bg-white border border-stone-200 rounded-xl text-xs font-bold text-stone-800 focus:outline-none focus:border-[#0f4c2a]"
                  />
                </div>
              </div>
            </div>
            
            {filteredExpenses.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-stone-300">
                <CreditCard className="w-8 h-8 text-stone-300 mx-auto mb-2" />
                <p className="text-stone-600 font-black text-xs uppercase tracking-wider">No Expenses Found</p>
                <p className="text-[10px] text-stone-400 font-bold mt-1">Expenses logged across all operational committees flow directly into this centralized ledger.</p>
              </div>
            ) : (
              <div className="bg-white border border-stone-200 rounded-2xl shadow-xs overflow-hidden">
                <div className="overflow-x-auto hide-scrollbar">
                  <table className="w-full text-left border-collapse min-w-[920px]">
                    <thead>
                      <tr className="bg-stone-50 text-[10px] font-black text-stone-500 uppercase tracking-widest border-b border-stone-200">
                        <th className="p-3">Date</th>
                        <th className="p-3">Committee</th>
                        <th className="p-3">Description</th>
                        <th className="p-3">Payee</th>
                        <th className="p-3 text-right">Amount (OMR)</th>
                        <th className="p-3 text-center">Status</th>
                        <th className="p-3 text-center">Action</th>
                        <th className="p-3 text-center">Manage</th>
                      </tr>
                    </thead>
                    <tbody className="text-xs font-bold text-stone-700">
                      {filteredExpenses.map((exp) => {
                        const isFinOwned = exp.isFinanceOwned ?? isFinanceOwnedExpense(exp);
                        const statusInfo = getExpenseLifecycleStatus(exp);
                        const payeeName = getExpensePayeeDisplayName(exp);
                        const payeeTooltip = getExpensePayeeTooltip(exp);

                        return (
                          <tr key={exp.id} className="border-b border-stone-100 hover:bg-stone-50/50">
                            <td className="p-3 font-mono text-[10px] text-stone-500 whitespace-nowrap">
                              {new Date(exp.date || (exp as any).createdAt || 0).toLocaleDateString()}
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              <span className={`px-2 py-1 rounded-lg text-[9px] uppercase font-black ${
                                isFinOwned
                                  ? 'bg-amber-100 text-amber-900 border border-amber-200'
                                  : 'bg-stone-100 text-stone-800'
                              }`}>
                                {formatCategoryLabel(exp.committeeName)}
                              </span>
                            </td>
                            <td className="p-3">
                              <div className="font-semibold text-stone-900">{exp.description}</div>
                              {exp.rejectionReason && statusInfo.code === 'rejected' && (
                                <div className="mt-1 text-[10px] text-rose-700 font-bold bg-rose-50 border border-rose-200 rounded-md p-1.5">
                                  <span className="font-black uppercase text-[9px] block">Rejection Reason:</span>
                                  {exp.rejectionReason}
                                </div>
                              )}
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              <div 
                                className="inline-flex items-center space-x-1.5 text-stone-800 font-semibold cursor-help"
                                title={payeeTooltip}
                              >
                                {exp.paidByType === 'resident' || exp.isPersonalPayment ? (
                                  <User className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                                ) : exp.paidByType === 'sponsor' ? (
                                  <Building className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                ) : (
                                  <CreditCard className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                )}
                                <span className="text-xs font-bold text-stone-800 hover:text-stone-950">
                                  {payeeName}
                                </span>
                              </div>
                            </td>
                            <td className="p-3 text-right font-mono font-black text-rose-700 whitespace-nowrap">
                              OMR {(Number(exp.amount) || 0).toFixed(3)}
                            </td>
                            <td className="p-3 text-center whitespace-nowrap">
                              {statusInfo.code === 'pending' ? (
                                <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-[10px] font-black uppercase tracking-wider">
                                  <Clock className="w-3 h-3 text-amber-700" />
                                  <span>Pending Review</span>
                                </span>
                              ) : statusInfo.code === 'approved' ? (
                                <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-[10px] font-black uppercase tracking-wider">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                                  <span>Approved</span>
                                </span>
                              ) : statusInfo.code === 'refund_pending' ? (
                                <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-sky-100 text-sky-800 border border-sky-300 rounded-lg text-[10px] font-black uppercase tracking-wider">
                                  <Clock className="w-3 h-3 text-sky-700" />
                                  <span>Refund Pending</span>
                                </span>
                              ) : statusInfo.code === 'refunded' ? (
                                <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-[10px] font-black uppercase tracking-wider">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                                  <span>Refunded</span>
                                </span>
                              ) : statusInfo.code === 'settled' ? (
                                <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-[10px] font-black uppercase tracking-wider">
                                  <Check className="w-3 h-3 text-emerald-700" />
                                  <span>Settled</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-rose-100 text-rose-800 border border-rose-200 rounded-lg text-[10px] font-black uppercase tracking-wider">
                                  <Ban className="w-3 h-3 text-rose-700" />
                                  <span>Rejected</span>
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-center whitespace-nowrap">
                              <div className="flex items-center justify-center space-x-1.5">
                                {statusInfo.code === 'pending' && !isFinOwned && (
                                  <>
                                    <button
                                      onClick={() => handleAcceptExpense(exp)}
                                      disabled={isFinanceSubmitting}
                                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center space-x-1 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
                                      title="Accept & Approve Expense into Financials"
                                    >
                                      <Check className="w-3 h-3" />
                                      <span>Accept</span>
                                    </button>
                                    <button
                                      onClick={() => {
                                        setRejectingExpense(exp);
                                        setRejectionReasonInput('');
                                        setShowRejectModal(true);
                                      }}
                                      disabled={isFinanceSubmitting}
                                      className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center space-x-1 transition-all cursor-pointer disabled:opacity-50"
                                      title="Reject Expense and Request Revision"
                                    >
                                      <Ban className="w-3 h-3" />
                                      <span>Reject</span>
                                    </button>
                                  </>
                                )}

                                {statusInfo.code !== 'pending' && (
                                  <span className="text-stone-300 text-xs font-bold">—</span>
                                )}
                              </div>
                            </td>
                            <td className="p-3 text-center whitespace-nowrap">
                              {isFinOwned ? (
                                <div className="flex items-center justify-center space-x-1">
                                  <button
                                    onClick={() => handleOpenEditExpense(exp)}
                                    className="p-1 text-stone-400 hover:text-[#0f4c2a] hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                                    title="Edit Finance Expense"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteExpense(exp.committeeId, exp.id, exp.committeeName, exp)}
                                    className="p-1 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                    title="Delete Finance Expense"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <span className="inline-flex items-center space-x-1 px-2 py-0.5 bg-stone-100 text-stone-500 rounded text-[9px] font-bold" title="Committee expenses must be edited or deleted by the originating committee">
                                  <Lock className="w-2.5 h-2.5" />
                                  <span>Committee</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-emerald-50/50 font-black text-xs text-emerald-950 border-t border-emerald-200">
                        <td colSpan={4} className="p-3 text-right uppercase tracking-wider">Accepted Financial Total (Budget-Impacted):</td>
                        <td className="p-3 text-right font-mono text-sm text-emerald-900">OMR {totalExpenses.toFixed(3)}</td>
                        <td colSpan={3} className="p-3 text-[10px] font-bold text-stone-500">
                          {acceptedExpenses.length} accepted / {centralizedExpenses.length} total recorded
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* 6. REFUNDS & PAYABLES TAB */}
        {/* ========================================================================= */}
        {financeTab === 'refunds' && (
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
              <h3 className="font-black text-stone-900 uppercase tracking-wider text-sm mb-1">Refunds & Payables Management</h3>
              <p className="text-xs text-stone-500 font-bold">Manage reimbursement settlements for accepted non-treasury committee expenses and registration refund obligations.</p>
            </div>

            {/* Filter & Search Bar with Compact RUN Action */}
            <div className="bg-stone-100/80 p-3 rounded-2xl border border-stone-200">
              <div className="flex flex-col md:flex-row items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                  <div className="flex items-center space-x-1.5">
                    <span className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Obligation View:</span>
                    <select
                      value={draftRefundFilterType}
                      onChange={(e: any) => setDraftRefundFilterType(e.target.value)}
                      className="bg-white border border-stone-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-stone-800 focus:outline-none focus:border-[#0f4c2a]"
                    >
                      <option value="all">All Obligations & Refunds</option>
                      <option value="pending_payables">Pending Reimbursements</option>
                      <option value="settled_payables">Settled Reimbursements</option>
                      <option value="pending_refunds">Pending Registration Refunds</option>
                      <option value="processed_refunds">Processed Registration Refunds</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleRunRefundsFilter}
                    className="cursor-pointer px-3 py-1.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-[10px] uppercase tracking-wider rounded-xl transition-all shadow-2xs flex items-center space-x-1.5 shrink-0"
                    title="Apply Filters"
                  >
                    <Play className="w-3 h-3 text-[#d4af37] fill-[#d4af37]" />
                    <span>RUN</span>
                  </button>

                  {(draftRefundFilterType !== 'all' || draftRefundSearch.trim() !== '' || appliedRefundFilterType !== 'all' || appliedRefundSearch.trim() !== '') && (
                    <button
                      type="button"
                      onClick={handleClearRefundsFilter}
                      className="cursor-pointer px-2.5 py-1.5 bg-stone-800 hover:bg-stone-900 text-white font-bold text-[10px] rounded-xl flex items-center gap-1 transition-colors shadow-xs"
                      title="Clear All Filters"
                    >
                      <X className="w-3 h-3" />
                      <span>Clear All</span>
                    </button>
                  )}
                </div>

                <div className="relative w-full md:w-60">
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={draftRefundSearch}
                    onChange={(e) => setDraftRefundSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRunRefundsFilter(); }}
                    placeholder="Search payee, GMK ID, unit, ref..."
                    className="w-full pl-8 pr-3 py-1.5 bg-white border border-stone-200 rounded-xl text-xs font-bold text-stone-800 focus:outline-none focus:border-[#0f4c2a]"
                  />
                </div>
              </div>
            </div>
            
            {/* 1. NON-TREASURY EXPENSES & REIMBURSEMENTS (Payables) */}
            {(appliedRefundFilterType === 'all' || appliedRefundFilterType === 'pending_payables' || appliedRefundFilterType === 'settled_payables') && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <HandCoins className="w-4 h-4 text-sky-700" />
                    <h4 className="font-black text-stone-900 uppercase tracking-wider text-xs">
                      Non-Treasury Payables & Reimbursements ({acceptedNonTreasuryExpenses.length})
                    </h4>
                  </div>
                  <span className="text-[10px] font-bold text-stone-500">
                    Pending: <strong className="text-amber-800">OMR {totalPendingPayablesAmount.toFixed(3)}</strong> | Settled: <strong className="text-emerald-800">OMR {totalSettledPayablesAmount.toFixed(3)}</strong>
                  </span>
                </div>

                {/* Pending Reimbursements */}
                {(appliedRefundFilterType === 'all' || appliedRefundFilterType === 'pending_payables') && (
                  <div className="space-y-3">
                    <div className="text-[10px] font-black uppercase text-amber-900 tracking-wider">
                      Pending Reimbursements ({filteredPendingPayables.length})
                    </div>
                    {filteredPendingPayables.length === 0 ? (
                      <div className="text-center py-6 bg-stone-50 rounded-xl border border-dashed border-stone-200 text-stone-400 font-bold text-xs">
                        {appliedRefundSearch ? 'No pending reimbursements match your search.' : 'No pending non-treasury reimbursements.'}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {filteredPendingPayables.map(exp => (
                          <div key={exp.id} className="p-4 bg-white border border-sky-200 rounded-2xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="space-y-1.5">
                              <div className="flex items-center space-x-2">
                                <span className="font-mono text-[10px] font-black bg-stone-100 px-2 py-0.5 rounded-md">{formatCategoryLabel(exp.committeeName)}</span>
                                <span className="font-black text-stone-900 text-sm">{exp.description}</span>
                              </div>
                              
                              <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-stone-600">
                                <div className="inline-flex items-center space-x-1 text-sky-900 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-200">
                                  <User className="w-3 h-3 text-sky-700" />
                                  <span>Payee: <strong>{exp.paidByName || 'Resident'}</strong></span>
                                  {(exp.paidByUnit || exp.paidByResidentId) && (
                                    <span className="ml-1 cursor-help" title={`Unit: ${exp.paidByUnit || 'N/A'}\nGMK ID: ${exp.paidByResidentId || 'N/A'}`}>
                                      <Info className="w-3 h-3 text-sky-500 inline-block" />
                                    </span>
                                  )}
                                </div>
                                {exp.paidByPhone && (
                                  <span className="text-[10px] text-stone-500 font-mono">Phone: {exp.paidByPhone}</span>
                                )}
                                <span className="text-rose-700 font-mono font-black">Reimbursement Due: OMR {(Number(exp.amount) || 0).toFixed(3)}</span>
                              </div>
                            </div>

                            <button
                              onClick={() => {
                                setSettlingExpense(exp);
                                setSettleMethodInput('Bank Transfer');
                                setSettleRefInput('');
                                setSettleRemarksInput('');
                                setShowSettleModal(true);
                              }}
                              disabled={isFinanceSubmitting}
                              className="px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all w-full md:w-auto text-center cursor-pointer shadow-xs disabled:opacity-50 flex items-center justify-center space-x-1.5"
                            >
                              <FileCheck className="w-3.5 h-3.5 text-[#d4af37]" />
                              <span>Settle Reimbursement</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Settled Reimbursements History */}
                {(appliedRefundFilterType === 'all' || appliedRefundFilterType === 'settled_payables') && (
                  <div className="space-y-3 pt-2">
                    <div className="text-[10px] font-black uppercase text-emerald-900 tracking-wider">
                      Settled Reimbursements History ({filteredSettledPayables.length})
                    </div>
                    {filteredSettledPayables.length === 0 ? (
                      <div className="text-center py-6 bg-stone-50 rounded-xl border border-dashed border-stone-200 text-stone-400 font-bold text-xs">
                        {appliedRefundSearch ? 'No settled reimbursements match your search.' : 'No settled reimbursements.'}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {filteredSettledPayables.map(exp => (
                          <div key={exp.id} className="p-3.5 bg-white border border-emerald-200/80 rounded-xl shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="space-y-1">
                              <div className="flex items-center space-x-2">
                                <span className="font-mono text-[9px] font-black bg-stone-100 px-1.5 py-0.5 rounded text-stone-600">{formatCategoryLabel(exp.committeeName)}</span>
                                <span className="font-bold text-stone-900 text-xs">{exp.description}</span>
                                <span className="text-[9px] font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded uppercase">Settled</span>
                              </div>
                              <div className="text-[10px] text-stone-500 font-bold flex flex-wrap gap-x-3">
                                <span>Payee: {exp.paidByName || 'Resident'}</span>
                                <span>Method: {exp.settlementMethod || 'Bank Transfer'}</span>
                                {exp.settlementReference && <span>Ref: {exp.settlementReference}</span>}
                                {exp.settledAt && <span>Date: {new Date(exp.settledAt).toLocaleDateString()}</span>}
                              </div>
                            </div>
                            <div className="text-right font-mono font-black text-emerald-800 text-xs">
                              OMR {(Number(exp.amount) || 0).toFixed(3)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {(appliedRefundFilterType === 'all') && (
              <hr className="border-stone-200" />
            )}
            
            {/* 2. REGISTRATION REFUNDS */}
            {(appliedRefundFilterType === 'all' || appliedRefundFilterType === 'pending_refunds' || appliedRefundFilterType === 'processed_refunds') && (
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-amber-700" />
                  <h4 className="font-black text-stone-900 uppercase tracking-wider text-xs">
                    Registration Refunds & Adjustments
                  </h4>
                </div>

                {/* Pending Refunds */}
                {(appliedRefundFilterType === 'all' || appliedRefundFilterType === 'pending_refunds') && (
                  <div className="space-y-3">
                    <h5 className="font-black text-amber-800 uppercase tracking-wider text-[10px] px-1">
                      Pending Registration Refunds ({filteredPendingRefunds.length})
                    </h5>
                    {filteredPendingRefunds.length === 0 ? (
                      <div className="text-center py-6 bg-stone-50 rounded-xl border border-dashed border-stone-200 text-stone-400 font-bold text-xs">
                        {appliedRefundSearch ? 'No pending refunds match your search.' : 'No pending registration refunds.'}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {filteredPendingRefunds.map(reg => {
                          const amtRec = Number(reg.amountReceived ?? (reg.paymentStatus === 'paid' ? (reg.amountDue ?? reg.paymentAmount ?? 0) : 0));
                          const amtDue = Number(reg.amountDue ?? (reg.paymentStatus === 'cancelled' ? 0 : (reg.paymentAmount ?? 0)));
                          const refundAmt = reg.refundDue || Math.max(0, amtRec - amtDue);
                          
                          return (
                            <div key={reg.id} className="p-4 bg-white border border-amber-200 rounded-2xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                              <div>
                                <div className="flex items-center space-x-2 mb-1">
                                  <span className="font-mono text-[10px] font-black bg-stone-100 px-2 py-0.5 rounded-md">{reg.primaryMemberGmkId}</span>
                                  <span className="font-black text-stone-800 text-sm">{reg.primaryMemberEmail}</span>
                                </div>
                                <div className="text-[10px] text-stone-500 font-bold flex space-x-4 mt-2">
                                  <span>Paid: OMR {amtRec.toFixed(3)}</span>
                                  <span>Due: OMR {amtDue.toFixed(3)}</span>
                                  <span className="text-amber-700 font-black">Refund Due: OMR {refundAmt.toFixed(3)}</span>
                                </div>
                              </div>
                              <button
                                onClick={() => handleProcessRefund(reg)}
                                disabled={isFinanceSubmitting}
                                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all w-full md:w-auto text-center disabled:opacity-50 cursor-pointer"
                              >
                                {isFinanceSubmitting ? 'Processing...' : 'Process Refund'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Processed Refunds */}
                {(appliedRefundFilterType === 'all' || appliedRefundFilterType === 'processed_refunds') && (
                  <div className="space-y-3 mt-4">
                    <h5 className="font-black text-emerald-800 uppercase tracking-wider text-[10px] px-1">
                      Processed / Resolved Refunds ({filteredProcessedRefunds.length})
                    </h5>
                    {filteredProcessedRefunds.length === 0 ? (
                      <div className="text-center py-6 bg-stone-50 rounded-xl border border-dashed border-stone-200 text-stone-400 font-bold text-xs">
                        {appliedRefundSearch ? 'No processed refunds history matches your search.' : 'No processed refunds history.'}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {filteredProcessedRefunds.map(reg => (
                          <div key={reg.id} className="p-3 bg-white border border-stone-200 rounded-xl shadow-xs flex items-center justify-between opacity-80">
                            <div className="flex items-center space-x-3">
                              <span className="font-mono text-[10px] font-black bg-stone-100 px-2 py-0.5 rounded-md">{reg.primaryMemberGmkId}</span>
                              <span className="font-bold text-stone-800 text-xs">{reg.primaryMemberEmail}</span>
                            </div>
                            <span className="text-[10px] uppercase font-black px-2 py-0.5 bg-stone-100 text-stone-600 rounded">
                              {reg.paymentStatus}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* 7. REPORTS TAB */}
        {/* ========================================================================= */}
        {financeTab === 'reports' && (
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-black text-stone-900 uppercase tracking-wider text-sm mb-1">Financial Statements & Workspace Reports</h3>
                <p className="text-xs text-stone-500 font-bold">Generate official statements, committee budget utilization, centralized expense ledgers, and refunds & payables reports in PDF and Excel formats.</p>
              </div>
              <span className="shrink-0 px-3 py-1 bg-emerald-50 text-[#0f4c2a] border border-emerald-200 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center space-x-1">
                <FileCheck className="w-3.5 h-3.5 text-[#d4af37]" />
                <span>Audit Ready</span>
              </span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Report 1: Financial Statement */}
              <div className="p-6 bg-white border border-stone-200 rounded-2xl shadow-xs flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center space-x-3 mb-3">
                    <div className="w-10 h-10 bg-emerald-50 text-[#0f4c2a] rounded-xl flex items-center justify-center border border-emerald-100 shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-black text-stone-900 uppercase text-sm">Event Financial Statement</h4>
                      <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100/60 px-2 py-0.5 rounded-md uppercase">Statement of Accounts</span>
                    </div>
                  </div>
                  <p className="text-xs text-stone-500 font-bold">Comprehensive accounting of opening balance, registration income, sponsorships, and total centralized expenditures.</p>
                </div>
                <div className="pt-3 border-t border-stone-100">
                  <button 
                    onClick={generateFinancialSummaryPDF}
                    className="px-4 py-2.5 bg-[#0f4c2a] text-white font-black uppercase text-xs tracking-wider rounded-xl hover:bg-[#0c3e22] transition-colors w-full flex items-center justify-center space-x-2 cursor-pointer shadow-xs"
                  >
                    <Download className="w-4 h-4 text-[#d4af37]" />
                    <span>Download Statement PDF</span>
                  </button>
                </div>
              </div>

              {/* Report 2: Committee Budgets */}
              <div className="p-6 bg-white border border-stone-200 rounded-2xl shadow-xs flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center space-x-3 mb-3">
                    <div className="w-10 h-10 bg-blue-50 text-blue-700 rounded-xl flex items-center justify-center border border-blue-100 shrink-0">
                      <PieChart className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-black text-stone-900 uppercase text-sm">Committee Budgets & Utilization</h4>
                      <span className="text-[10px] font-bold text-blue-800 bg-blue-100/60 px-2 py-0.5 rounded-md uppercase">Allocation Analysis</span>
                    </div>
                  </div>
                  <p className="text-xs text-stone-500 font-bold">Detailed breakdown of allocations, actual expense utilization, and remaining margins across all operational committees.</p>
                </div>
                <div className="pt-3 border-t border-stone-100">
                  <button 
                    onClick={generateCommitteeBudgetPDF}
                    className="px-4 py-2.5 bg-blue-700 text-white font-black uppercase text-xs tracking-wider rounded-xl hover:bg-blue-800 transition-colors w-full flex items-center justify-center space-x-2 cursor-pointer shadow-xs"
                  >
                    <Download className="w-4 h-4 text-[#d4af37]" />
                    <span>Download Budgets PDF</span>
                  </button>
                </div>
              </div>

              {/* Report 3: Centralized Expenses Ledger */}
              <div className="p-6 bg-white border border-stone-200 rounded-2xl shadow-xs flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center space-x-3 mb-3">
                    <div className="w-10 h-10 bg-amber-50 text-amber-800 rounded-xl flex items-center justify-center border border-amber-200 shrink-0">
                      <CreditCard className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-black text-stone-900 uppercase text-sm">Centralized Expenses Ledger</h4>
                      <span className="text-[10px] font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded-md uppercase">
                        {centralizedExpenses.length} Records • OMR {totalExpenses.toFixed(3)} Accepted
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-stone-500 font-bold">Complete governance ledger of all committee and event expenses, payer sources (Treasury, Resident, Sponsor), review statuses, and settlement tracking.</p>
                </div>
                <div className="pt-3 border-t border-stone-100 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button 
                    onClick={handleExportExpensesExcel}
                    disabled={centralizedExpenses.length === 0}
                    className="px-3.5 py-2.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-900 font-black uppercase text-xs tracking-wider rounded-xl transition-all flex items-center justify-center space-x-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
                    title="Export Centralized Expenses to Excel"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                    <span>Export Excel</span>
                  </button>
                  <button 
                    onClick={handleExportExpensesPDF}
                    disabled={centralizedExpenses.length === 0}
                    className="px-3.5 py-2.5 bg-[#0f4c2a] text-white font-black uppercase text-xs tracking-wider rounded-xl hover:bg-[#0c3e22] transition-colors flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                    title="Export Centralized Expenses to PDF"
                  >
                    <FileText className="w-4 h-4 text-[#d4af37]" />
                    <span>Export PDF</span>
                  </button>
                </div>
              </div>

              {/* Report 4: Refunds & Payables Report */}
              <div className="p-6 bg-white border border-stone-200 rounded-2xl shadow-xs flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center space-x-3 mb-3">
                    <div className="w-10 h-10 bg-sky-50 text-sky-800 rounded-xl flex items-center justify-center border border-sky-200 shrink-0">
                      <HandCoins className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-black text-stone-900 uppercase text-sm">Refunds & Payables Report</h4>
                      <span className="text-[10px] font-bold text-sky-900 bg-sky-100 px-2 py-0.5 rounded-md uppercase">
                        {pendingPayables.length + pendingRefunds.length} Pending Actions
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-stone-500 font-bold">Detailed audit report of committee out-of-pocket reimbursement payables and registration overpayment/cancellation refund disbursements.</p>
                </div>
                <div className="pt-3 border-t border-stone-100 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button 
                    onClick={handleExportRefundsExcel}
                    className="px-3.5 py-2.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-900 font-black uppercase text-xs tracking-wider rounded-xl transition-all flex items-center justify-center space-x-1.5 cursor-pointer shadow-2xs"
                    title="Export Refunds & Payables to Excel"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                    <span>Export Excel</span>
                  </button>
                  <button 
                    onClick={handleExportRefundsPDF}
                    className="px-3.5 py-2.5 bg-[#0f4c2a] text-white font-black uppercase text-xs tracking-wider rounded-xl hover:bg-[#0c3e22] transition-colors flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs"
                    title="Export Refunds & Payables to PDF"
                  >
                    <FileText className="w-4 h-4 text-[#d4af37]" />
                    <span>Export PDF</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODALS */}
      {/* ========================================================================= */}

      {/* 1. SET OPENING BALANCE MODAL */}
      {showOpeningBalModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-150 pb-3">
              <div className="flex items-center space-x-2">
                <Settings className="w-4 h-4 text-[#0f4c2a]" />
                <h4 className="font-black text-stone-900 uppercase tracking-wider text-sm">Set Opening Balance</h4>
              </div>
              <button 
                onClick={() => setShowOpeningBalModal(false)}
                className="text-stone-400 hover:text-stone-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-stone-600 font-bold">
                Enter the previous year's closing balance carried forward into this event. This amount represents non-income opening funds that directly contribute to the Available Balance.
              </p>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                  Opening Balance Amount (OMR)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono font-black text-xs text-stone-400">OMR</span>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={openingBalInput}
                    onChange={(e) => setOpeningBalInput(e.target.value)}
                    placeholder="0.000"
                    className="w-full pl-12 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-xl font-mono text-sm font-black text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-stone-150">
              <button
                type="button"
                onClick={() => setShowOpeningBalModal(false)}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-black text-xs uppercase tracking-wider rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveOpeningBalance}
                disabled={isFinanceSubmitting}
                className="px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-sm disabled:opacity-50"
              >
                {isFinanceSubmitting ? 'Saving...' : 'Save Opening Balance'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. ALLOCATE BUDGET MODAL */}
      {showBudgetModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-150 pb-3">
              <div className="flex items-center space-x-2">
                <PieChart className="w-4 h-4 text-[#0f4c2a]" />
                <h4 className="font-black text-stone-900 uppercase tracking-wider text-sm">Allocate Committee Budget</h4>
              </div>
              <button 
                onClick={() => setShowBudgetModal(false)}
                className="text-stone-400 hover:text-stone-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                  Budget Allocation Target
                </label>
                <select
                  value={budgetCommittee}
                  onChange={(e) => setBudgetCommittee(e.target.value)}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                >
                  <option value="">-- Choose Target Committee / Category --</option>
                  <option value="Event">Event (Event-Level Budget)</option>
                  {activeCommittees.map(c => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                  Budget Allocation Amount (OMR)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono font-black text-xs text-stone-400">OMR</span>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={budgetAmountInput}
                    onChange={(e) => setBudgetAmountInput(e.target.value)}
                    placeholder="0.000"
                    className="w-full pl-12 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-xl font-mono text-sm font-black text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                  Purpose / Notes (Optional)
                </label>
                <input
                  type="text"
                  value={budgetDescInput}
                  onChange={(e) => setBudgetDescInput(e.target.value)}
                  placeholder="e.g. Operational funds for gathering supplies"
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-stone-150">
              <button
                type="button"
                onClick={() => setShowBudgetModal(false)}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-black text-xs uppercase tracking-wider rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveBudget}
                disabled={isFinanceSubmitting}
                className="px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-sm disabled:opacity-50"
              >
                {isFinanceSubmitting ? 'Saving...' : 'Save Allocation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. RECORD / EDIT EXPENSE MODAL */}
      {showExpenseModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-stone-150 pb-3">
              <div className="flex items-center space-x-2">
                <CreditCard className="w-4 h-4 text-[#0f4c2a]" />
                <h4 className="font-black text-stone-900 uppercase tracking-wider text-sm">
                  {editingExpense ? 'Edit Expense' : 'Enter Expense'}
                </h4>
              </div>
              <button 
                onClick={() => {
                  setShowExpenseModal(false);
                  setEditingExpense(null);
                }}
                className="text-stone-400 hover:text-stone-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                  Expense Category / Committee
                </label>
                <select
                  value={expenseCommittee}
                  onChange={(e) => setExpenseCommittee(e.target.value)}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                >
                  <option value="">Choose Committee / Category</option>
                  <option value="EVENT_EXPENSE">Event (Event-Level Expense)</option>
                  {activeCommittees.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                  Expense Description
                </label>
                <input
                  type="text"
                  value={expenseDescInput}
                  onChange={(e) => setExpenseDescInput(e.target.value)}
                  placeholder="e.g. Catering advance, Sound system rental"
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                    Amount (OMR)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={expenseAmountInput}
                    onChange={(e) => setExpenseAmountInput(e.target.value)}
                    placeholder="0.000"
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl font-mono text-xs font-black text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                    Expense Date
                  </label>
                  <input
                    type="date"
                    value={expenseDateInput}
                    onChange={(e) => setExpenseDateInput(e.target.value)}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">
                  Payee / Vendor (Optional)
                </label>
                <input
                  type="text"
                  value={expensePayeeInput}
                  onChange={(e) => setExpensePayeeInput(e.target.value)}
                  placeholder="e.g. Muscat Catering Services LLC"
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                />
              </div>

              {/* WHO PAID / PAYMENT SOURCE SECTION */}
              <div className="space-y-2 pt-2 border-t border-stone-150">
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-700">
                  Who Paid / Payment Source
                </label>
                
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setExpensePaidByType('event_treasury');
                      setExpensePaidByResidentId('');
                      setExpensePaidByName('');
                      setExpensePaidByUnit('');
                      setExpensePaidByPhone('');
                      setExpensePaidByEmail('');
                      setExpensePaidBySponsorId('');
                    }}
                    className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center space-y-1 ${
                      expensePaidByType === 'event_treasury'
                        ? 'bg-emerald-50 border-emerald-600 text-emerald-900 shadow-xs ring-2 ring-emerald-500/20'
                        : 'bg-stone-50 border-stone-200 text-stone-600 hover:bg-stone-100'
                    }`}
                  >
                    <CreditCard className={`w-4 h-4 ${expensePaidByType === 'event_treasury' ? 'text-emerald-700' : 'text-stone-400'}`} />
                    <span className="text-[10px] font-black uppercase tracking-wider">Event Treasury</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setExpensePaidByType('resident');
                      setExpensePaidBySponsorId('');
                    }}
                    className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center space-y-1 ${
                      expensePaidByType === 'resident'
                        ? 'bg-sky-50 border-sky-600 text-sky-900 shadow-xs ring-2 ring-sky-500/20'
                        : 'bg-stone-50 border-stone-200 text-stone-600 hover:bg-stone-100'
                    }`}
                  >
                    <User className={`w-4 h-4 ${expensePaidByType === 'resident' ? 'text-sky-700' : 'text-stone-400'}`} />
                    <span className="text-[10px] font-black uppercase tracking-wider">GMK Resident</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setExpensePaidByType('sponsor');
                      setExpensePaidByResidentId('');
                      setExpensePaidByUnit('');
                      setExpensePaidByPhone('');
                      setExpensePaidByEmail('');
                    }}
                    className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center space-y-1 ${
                      expensePaidByType === 'sponsor'
                        ? 'bg-amber-50 border-amber-500 text-amber-950 shadow-xs ring-2 ring-amber-500/20'
                        : 'bg-stone-50 border-stone-200 text-stone-600 hover:bg-stone-100'
                    }`}
                  >
                    <Building className={`w-4 h-4 ${expensePaidByType === 'sponsor' ? 'text-amber-700' : 'text-stone-400'}`} />
                    <span className="text-[10px] font-black uppercase tracking-wider text-center">Registered<br/>Sponsor</span>
                  </button>
                </div>

                {/* Resident Payer Selection */}
                {expensePaidByType === 'resident' && (
                  <div className="bg-sky-50/50 p-3 rounded-xl border border-sky-200/80 space-y-2 animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black uppercase tracking-wider text-sky-900 block">
                        Select GMK Resident / Spouse
                      </label>
                      <span className="text-[9px] font-bold text-sky-700">From Resident Registry</span>
                    </div>

                    {expensePaidByName && expensePaidByResidentId ? (
                      <div className="bg-white p-2.5 rounded-lg border border-sky-300 flex items-center justify-between shadow-2xs">
                        <div className="flex items-center space-x-2">
                          <CheckCircle2 className="w-4 h-4 text-sky-700 shrink-0" />
                          <div>
                            <div className="text-xs font-black text-stone-900 flex items-center space-x-1.5">
                              <span>{expensePaidByName}</span>
                              {expensePaidByUnit && (
                                <span className="text-[10px] text-stone-500 font-bold">({expensePaidByUnit})</span>
                              )}
                            </div>
                            <div className="text-[9px] font-mono text-sky-800 font-bold">
                              ID: {expensePaidByResidentId} {expensePaidByPhone ? `• ${expensePaidByPhone}` : ''}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setExpensePaidByResidentId('');
                            setExpensePaidByName('');
                            setExpensePaidByUnit('');
                            setExpensePaidByPhone('');
                            setExpensePaidByEmail('');
                          }}
                          className="text-stone-400 hover:text-stone-600 text-xs p-1"
                          title="Change Resident"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="relative">
                          <Search className="w-3 h-3 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={residentSearchTerm}
                            onChange={(e) => setResidentSearchTerm(e.target.value)}
                            placeholder="Search resident by name, GMK ID, or unit..."
                            className="w-full pl-7 pr-3 py-1.5 bg-white border border-stone-200 rounded-lg text-xs font-bold text-stone-800 focus:outline-none focus:border-[#0f4c2a]"
                          />
                        </div>

                        <div className="max-h-36 overflow-y-auto bg-white border border-stone-200 rounded-lg divide-y divide-stone-100 text-xs">
                          {filteredResidentCandidates.length === 0 ? (
                            <div className="p-3 text-center text-stone-400 font-bold text-[11px]">
                              No matching resident or spouse found.
                            </div>
                          ) : (
                            filteredResidentCandidates.map(cand => (
                              <button
                                key={cand.key}
                                type="button"
                                onClick={() => {
                                  setExpensePaidByResidentId(cand.residentId);
                                  setExpensePaidByName(cand.fullName);
                                  setExpensePaidByUnit(cand.unit);
                                  setExpensePaidByPhone(cand.phone);
                                  setExpensePaidByEmail(cand.email);
                                  setResidentSearchTerm('');
                                }}
                                className="w-full p-2 text-left hover:bg-sky-50/70 transition-colors flex items-center justify-between cursor-pointer"
                              >
                                <div>
                                  <div className="font-bold text-stone-900 flex items-center space-x-1.5">
                                    <span>{cand.fullName}</span>
                                    <span className="text-[9px] px-1.5 py-0.2 bg-stone-100 text-stone-600 rounded font-black uppercase">
                                      {cand.relationship}
                                    </span>
                                  </div>
                                  <div className="text-[9px] text-stone-500 font-mono">
                                    {cand.residentId} • Unit {cand.unit || 'N/A'}
                                  </div>
                                </div>
                                <span className="text-[10px] font-black text-sky-700 uppercase">Select</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Sponsor Payer Selection */}
                {expensePaidByType === 'sponsor' && (
                  <div className="bg-amber-50/50 p-3 rounded-xl border border-amber-200/80 space-y-2 animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black uppercase tracking-wider text-amber-950 block">
                        Registered Sponsor
                      </label>
                      <span className="text-[9px] font-bold text-amber-800">Event Sponsorship</span>
                    </div>

                    {sponsorOptions.length > 0 ? (
                      <div>
                        <label className="text-[9px] font-bold text-stone-500 block mb-1">
                          Select from Recorded Event Sponsors:
                        </label>
                        <select
                          value={expensePaidBySponsorId}
                          onChange={(e) => {
                            const sponId = e.target.value;
                            setExpensePaidBySponsorId(sponId);
                            const found = sponsorOptions.find(s => s.id === sponId);
                            if (found) {
                              setExpensePaidByName(found.name);
                            } else {
                              setExpensePaidByName('');
                            }
                          }}
                          className="w-full px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-xs font-bold text-stone-800 focus:outline-none focus:border-amber-600"
                        >
                          <option value="">-- Choose Event Sponsor --</option>
                          {sponsorOptions.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="p-3 text-center text-amber-900 bg-amber-100/50 rounded-lg text-xs font-bold border border-amber-200">
                        No registered sponsors available for this event.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-stone-150">
              <button
                type="button"
                onClick={() => {
                  setShowExpenseModal(false);
                  setEditingExpense(null);
                }}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-black text-xs uppercase tracking-wider rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveExpense}
                disabled={isFinanceSubmitting}
                className="px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-sm disabled:opacity-50"
              >
                {isFinanceSubmitting 
                  ? (editingExpense ? 'Updating...' : 'Entering...') 
                  : (editingExpense ? 'Update Expense' : 'Enter Expense')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Registration Details Modal */}
      {isRegistrationModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-5xl w-full p-6 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-stone-150 pb-3 shrink-0">
              <div className="flex items-center space-x-2">
                <Receipt className="w-5 h-5 text-[#0f4c2a]" />
                <h4 className="font-black text-[#0f4c2a] uppercase tracking-wider text-sm">Registration Income Breakdown</h4>
              </div>
              <button onClick={() => setIsRegistrationModalOpen(false)} className="text-stone-400 hover:text-stone-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex items-center justify-between gap-3 pb-2 shrink-0">
              <p className="text-stone-500 text-[10px] font-bold">Collected registration payments for {activeEvent?.title || 'active event'}.</p>
              <div className="relative max-w-xs w-full">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={finSearchQuery}
                  onChange={(e) => setFinSearchQuery(e.target.value)}
                  placeholder="Search by GMK ID, name, or email..."
                  className="w-full pl-8 pr-3 py-1.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-800 focus:outline-none focus:border-[#0f4c2a]"
                />
              </div>
            </div>

            <div className="overflow-y-auto hide-scrollbar flex-1">
              {filteredIncomeRegs.length === 0 ? (
                <div className="text-center py-10 bg-stone-50 rounded-xl border border-dashed border-stone-200 h-full flex flex-col items-center justify-center">
                  <Receipt className="w-8 h-8 text-stone-300 mx-auto mb-2" />
                  <p className="text-stone-600 font-black text-xs uppercase tracking-wider">No Collected Registration Payments Yet</p>
                  <p className="text-[10px] text-stone-400 font-bold mt-1">Registration income automatically calculates as residents make payments.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[650px]">
                    <thead className="sticky top-0 bg-stone-50 z-10">
                      <tr className="bg-stone-50 text-[10px] font-black text-stone-500 uppercase tracking-widest border-b border-stone-200">
                        <th className="p-3">Primary Registrant</th>
                        <th className="p-3">GMK ID</th>
                        <th className="p-3">Type</th>
                        <th className="p-3">Status</th>
                        <th className="p-3 text-right">Amount Due</th>
                        <th className="p-3 text-right">Collected (OMR)</th>
                      </tr>
                    </thead>
                    <tbody className="text-xs font-bold text-stone-700">
                      {filteredIncomeRegs.map((reg) => {
                        const collected = getRegistrationCollectedAmount(reg);
                        const due = reg.amountDue ?? reg.paymentAmount ?? reg.paymentSummary?.totalAmount ?? 0;
                        return (
                          <tr key={reg.id} className="border-b border-stone-100 hover:bg-stone-50/50">
                            <td className="p-3 font-semibold text-stone-900">{(reg.participants && reg.participants.length > 0) ? reg.participants[0] : reg.primaryMemberEmail}</td>
                            <td className="p-3 font-mono text-[10px]">{reg.primaryMemberGmkId}</td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 bg-stone-100 text-stone-700 text-[9px] font-black uppercase rounded-md">
                                {reg.registrationType || 'Family'}
                              </span>
                            </td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 text-[9px] font-black uppercase rounded-md ${collected >= due ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                                {collected >= due ? 'PAID' : 'PENDING'}
                              </span>
                            </td>
                            <td className="p-3 text-right font-mono text-[11px] text-stone-500">OMR {due.toFixed(3)}</td>
                            <td className="p-3 text-right font-mono font-black text-[#0f4c2a]">OMR {collected.toFixed(3)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="sticky bottom-0 bg-emerald-50/90 backdrop-blur z-10">
                      <tr className="font-black text-xs text-[#0f4c2a] border-t border-emerald-200">
                        <td colSpan={5} className="p-3 text-right uppercase tracking-wider">Total Registration Income:</td>
                        <td className="p-3 text-right font-mono text-sm">OMR {totalRegistrationRec.toFixed(3)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            <div className="pt-4 flex justify-end border-t border-stone-150 shrink-0">
              <button
                type="button"
                onClick={() => setIsRegistrationModalOpen(false)}
                className="px-6 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-black text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sponsorship Details Modal */}
      {isSponsorshipModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-4xl w-full p-6 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-stone-150 pb-3 shrink-0">
              <div className="flex items-center space-x-2">
                <DollarSign className="w-5 h-5 text-blue-700" />
                <h4 className="font-black text-stone-900 uppercase tracking-wider text-sm">Sponsorship Details</h4>
              </div>
              <button 
                onClick={() => setIsSponsorshipModalOpen(false)}
                className="text-stone-400 hover:text-stone-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="overflow-y-auto hide-scrollbar flex-1">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead>
                    <tr className="bg-stone-50 text-[10px] font-black text-stone-500 uppercase tracking-widest border-b border-stone-200">
                      <th className="p-3">Sponsor Name</th>
                      <th className="p-3">Payment Mode</th>
                      <th className="p-3">Date</th>
                      <th className="p-3">Notes</th>
                      <th className="p-3 text-right">Assured Amount</th>
                      <th className="p-3 text-right">Received Amount</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs font-bold text-stone-700">
                    {sponsorshipIncomeList.map((sponsor, idx) => (
                      <tr key={sponsor.id || idx} className="border-b border-stone-100 hover:bg-stone-50/50">
                        <td className="p-3 font-semibold text-stone-900">{sponsor.sponsorName}</td>
                        <td className="p-3"><span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[9px] font-black uppercase">{sponsor.paymentMode || sponsor.tier || 'N/A'}</span></td>
                        <td className="p-3 font-mono text-[10px] text-stone-500">{sponsor.date || '-'}</td>
                        <td className="p-3 text-[10px] text-stone-500">{sponsor.notes || '-'}</td>
                        <td className="p-3 text-right font-mono font-black text-stone-500">{(Number(sponsor.assuredAmount) || Number(sponsor.amount) || 0).toFixed(3)}</td>
                        <td className="p-3 text-right font-mono font-black text-blue-700">{(Number(sponsor.amount) || 0).toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            
            <div className="pt-4 flex justify-end border-t border-stone-150 shrink-0">
              <button
                type="button"
                onClick={() => setIsSponsorshipModalOpen(false)}
                className="px-6 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-black text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expense Rejection Modal */}
      {showRejectModal && rejectingExpense && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-150 pb-3">
              <div className="flex items-center space-x-2">
                <Ban className="w-5 h-5 text-rose-600" />
                <h4 className="font-black text-stone-900 uppercase tracking-wider text-sm">Reject Committee Expense</h4>
              </div>
              <button 
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectingExpense(null);
                }} 
                className="text-stone-400 hover:text-stone-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-stone-50 p-3 rounded-xl border border-stone-200 text-xs space-y-1">
              <div className="flex justify-between font-bold">
                <span className="text-stone-500">Committee:</span>
                <span className="text-stone-900">{rejectingExpense.committeeName}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span className="text-stone-500">Description:</span>
                <span className="text-stone-900">{rejectingExpense.description}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span className="text-stone-500">Amount:</span>
                <span className="text-rose-700 font-mono">OMR {(Number(rejectingExpense.amount) || 0).toFixed(3)}</span>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-stone-700 block mb-1">
                Reason for Rejection / Required Modifications <span className="text-rose-600">*</span>
              </label>
              <textarea
                value={rejectionReasonInput}
                onChange={(e) => setRejectionReasonInput(e.target.value)}
                placeholder="Specify why this expense is rejected so the originating committee can rectify and resubmit..."
                rows={3}
                className="w-full p-3 bg-white border border-stone-200 rounded-xl text-xs font-bold text-stone-800 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="pt-3 flex items-center justify-end space-x-2 border-t border-stone-150">
              <button
                type="button"
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectingExpense(null);
                }}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-black text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!rejectionReasonInput.trim() || isFinanceSubmitting}
                onClick={handleRejectExpense}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-xs disabled:opacity-50 cursor-pointer flex items-center space-x-1.5"
              >
                <Ban className="w-4 h-4" />
                <span>{isFinanceSubmitting ? 'Rejecting...' : 'Confirm Rejection'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settle Reimbursement Payable Modal */}
      {showSettleModal && settlingExpense && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-150 pb-3">
              <div className="flex items-center space-x-2">
                <FileCheck className="w-5 h-5 text-emerald-700" />
                <h4 className="font-black text-stone-900 uppercase tracking-wider text-sm">Settle Reimbursement Payable</h4>
              </div>
              <button 
                onClick={() => {
                  setShowSettleModal(false);
                  setSettlingExpense(null);
                }} 
                className="text-stone-400 hover:text-stone-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-sky-50/70 p-3.5 rounded-xl border border-sky-200 text-xs space-y-1.5">
              <div className="flex justify-between font-bold">
                <span className="text-sky-900">Payee:</span>
                <span className="text-stone-900 font-extrabold">{settlingExpense.paidByName || 'Resident'}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span className="text-sky-900">Committee / Item:</span>
                <span className="text-stone-800">{settlingExpense.committeeName} — {settlingExpense.description}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span className="text-sky-900">Reimbursement Amount:</span>
                <span className="text-emerald-800 font-mono font-black text-sm">OMR {(Number(settlingExpense.amount) || 0).toFixed(3)}</span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-stone-700 block mb-1">
                  Settlement Payment Method
                </label>
                <select
                  value={settleMethodInput}
                  onChange={(e) => setSettleMethodInput(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-stone-200 rounded-xl text-xs font-bold text-stone-800 focus:outline-none focus:border-[#0f4c2a]"
                >
                  <option value="Bank Transfer">Bank Transfer (Direct Account Deposit)</option>
                  <option value="Cash">Cash Handover</option>
                  <option value="Cheque">Cheque</option>
                  <option value="UPI / Online Transfer">UPI / Online Transfer</option>
                  <option value="Adjustment / Offset">Adjustment / Offset</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-stone-700 block mb-1">
                  Transaction / Transfer Reference Number
                </label>
                <input
                  type="text"
                  value={settleRefInput}
                  onChange={(e) => setSettleRefInput(e.target.value)}
                  placeholder="e.g. TXN-8934298 or Bank Ref #"
                  className="w-full px-3 py-2 bg-white border border-stone-200 rounded-xl text-xs font-bold text-stone-800 focus:outline-none focus:border-[#0f4c2a]"
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-stone-700 block mb-1">
                  Settlement Remarks (Optional)
                </label>
                <input
                  type="text"
                  value={settleRemarksInput}
                  onChange={(e) => setSettleRemarksInput(e.target.value)}
                  placeholder="Additional settlement notes..."
                  className="w-full px-3 py-2 bg-white border border-stone-200 rounded-xl text-xs font-bold text-stone-800 focus:outline-none focus:border-[#0f4c2a]"
                />
              </div>
            </div>

            <div className="pt-3 flex items-center justify-end space-x-2 border-t border-stone-150">
              <button
                type="button"
                onClick={() => {
                  setShowSettleModal(false);
                  setSettlingExpense(null);
                }}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-black text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isFinanceSubmitting}
                onClick={handleSettlePayable}
                className="px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-xs disabled:opacity-50 cursor-pointer flex items-center space-x-1.5"
              >
                <Check className="w-4 h-4 text-[#d4af37]" />
                <span>{isFinanceSubmitting ? 'Recording...' : 'Record Settlement'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GEAS Confirmation Dialog */}
      {isConfirmOpen && confirmOptions && (
        <GEASConfirmationDialogUI
          options={confirmOptions}
          onConfirm={handleConfirmAction}
          onCancel={handleCancelConfirm}
        />
      )}
    </div>
  );
}
