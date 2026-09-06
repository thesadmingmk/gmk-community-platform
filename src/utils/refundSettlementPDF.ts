import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { EventRegistration, EventRegistrationRefund, CommunityEvent, Family } from '../types';
import { 
  formatExternalGmkId, 
  formatEventDate, 
  formatEventTime, 
  getEventTitle, 
  getEventVenue 
} from './gmkIdHelper';

/**
 * Generates an official, computer-generated PDF Refund Voucher / Settlement Proof
 * conforming to Greens Malayalee Kootayama financial audit standards.
 * 
 * Heading: GMK EVENT REGISTRATION REFUND VOUCHER / SETTLEMENT RECEIPT
 * Sourced dynamically: Event Name, Date (DD MON YYYY), Oman Time, Venue.
 * Correct ID: GMK-XXXXG for external, GMK-XXXX for resident.
 * Category name for external (e.g. "Team Greens") or Unit for resident.
 */
export function generateRefundSettlementPDF(
  reg: EventRegistration,
  refundOrAmount: EventRegistrationRefund | number,
  methodParam?: string,
  refParam?: string,
  remarksParam?: string,
  eventObj?: CommunityEvent | null,
  residentUnit?: string | null
): void {
  try {
    const doc = new jsPDF();

    // Extract values safely
    let refundAmount = 0;
    let settlementMethod = 'Bank Transfer';
    let settlementRef = 'N/A';
    let remarks = '';
    let settlementDate = new Date();
    const refundStatus = 'SETTLED / COMPLETED';
    let refundReason = 'Registration Cancellation';
    let eventName = getEventTitle(eventObj);

    if (typeof refundOrAmount === 'object' && refundOrAmount !== null) {
      refundAmount = Number(refundOrAmount.amount) || 0;
      settlementMethod = refundOrAmount.settlementMethod || methodParam || 'Bank Transfer';
      settlementRef = refundOrAmount.settlementReference || refParam || 'N/A';
      remarks = refundOrAmount.remarks || remarksParam || '';
      if (refundOrAmount.date) settlementDate = new Date(refundOrAmount.date);
      if (refundOrAmount.refundReason) refundReason = refundOrAmount.refundReason;
      if (refundOrAmount.eventName) eventName = refundOrAmount.eventName;
    } else {
      refundAmount = Number(refundOrAmount) || 0;
      settlementMethod = methodParam || 'Bank Transfer';
      settlementRef = refParam || 'N/A';
      remarks = remarksParam || '';
    }

    const dateStr = settlementDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const timeStr = settlementDate.toLocaleTimeString('en-GB', { 
      timeZone: 'Asia/Muscat', 
      hour: '2-digit', 
      minute: '2-digit' 
    }) + ' (Oman Time)';

    const dynamicEventDate = formatEventDate(eventObj?.date || (eventObj as any)?.eventStart);
    const dynamicEventTime = formatEventTime((eventObj as any)?.eventStart || eventObj?.date);
    const dynamicVenue = getEventVenue(eventObj);

    const gmkId = reg.isExternal 
      ? (formatExternalGmkId(reg.publicReference) || formatExternalGmkId(reg.primaryMemberGmkId) || reg.publicReference || 'N/A')
      : (reg.primaryMemberGmkId || 'N/A');

    const categoryOrUnit = reg.isExternal
      ? (reg.externalRegistrationTypeName || 'External Guest')
      : (residentUnit || reg.unitNumber || 'Household Resident');

    const registrantName = reg.isExternal
      ? (reg.primaryRegistrantName || (reg.participants && reg.participants[0]) || reg.primaryMemberEmail || 'Guest')
      : (reg.primaryRegistrantName || (reg.participants && reg.participants[0]) || (reg as any).primaryMemberName || reg.primaryMemberEmail || 'Member');

    const attendeeCount = reg.totalParticipants || (reg.participants ? reg.participants.length : 1);
    const email = reg.primaryRegistrantEmail || reg.primaryMemberEmail || 'N/A';
    const actualReceived = Number(
      reg.amountReceived !== undefined && reg.amountReceived !== null
        ? reg.amountReceived
        : (reg.paymentStatus === 'paid' ? (reg.amountDue ?? reg.paymentAmount ?? refundAmount) : refundAmount)
    );

    // Branding Header (Greens Malayalee Kootayama)
    doc.setFillColor(15, 76, 42); // #0f4c2a (GMK Green)
    doc.rect(0, 0, 210, 28, 'F');

    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text("GREENS MALAYALEE KOOTAYAMA", 14, 13);

    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(212, 175, 55); // Gold
    doc.text("COMMUNITY MANAGEMENT PLATFORM · FINANCE DEPARTMENT", 14, 21);

    // Voucher Title Bar
    doc.setFillColor(245, 247, 245);
    doc.rect(14, 34, 182, 18, 'F');
    doc.setDrawColor(220, 225, 220);
    doc.rect(14, 34, 182, 18, 'S');

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 76, 42);
    doc.text("GMK EVENT REGISTRATION REFUND VOUCHER / SETTLEMENT RECEIPT", 18, 45);

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text(`Status: ${refundStatus}`, 150, 45);

    // Metadata Grid
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(50, 50, 50);
    doc.text("EVENT & SETTLEMENT DETAILS", 14, 60);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(90, 90, 90);
    doc.text(`Voucher Ref: REF-${gmkId}`, 14, 67);
    doc.text(`Event Name: ${eventName}`, 14, 73);
    doc.text(`Event Date & Time: ${dynamicEventDate} • ${dynamicEventTime}`, 14, 79);
    doc.text(`Event Venue: ${dynamicVenue}`, 14, 85);

    doc.text(`Settlement Date: ${dateStr} ${timeStr}`, 115, 67);
    doc.text(`Classification: Settled Payable Disbursal`, 115, 73);
    doc.text(`Settlement Method: ${settlementMethod}`, 115, 79);
    doc.text(`Bank / Txn Ref: ${settlementRef}`, 115, 85);

    doc.setDrawColor(230, 230, 230);
    doc.line(14, 90, 196, 90);

    // Beneficiary Information
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(50, 50, 50);
    doc.text("BENEFICIARY DETAILS", 14, 98);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(90, 90, 90);
    doc.text(`Registrant Name: ${registrantName}`, 14, 105);
    doc.text(`Registered Email: ${email}`, 14, 111);
    doc.text(`GMK ID: ${gmkId}`, 115, 105);
    doc.text(`Category / Unit: ${categoryOrUnit} (${attendeeCount} ${attendeeCount === 1 ? 'attendee' : 'attendees'})`, 115, 111);

    // Settlement Breakdown Table
    autoTable(doc, {
      startY: 118,
      theme: 'grid',
      headStyles: { 
        fillColor: [15, 76, 42], 
        textColor: [255, 255, 255], 
        fontStyle: 'bold',
        fontSize: 9
      },
      styles: { 
        fontSize: 9, 
        cellPadding: 4, 
        textColor: [40, 40, 40] 
      },
      columnStyles: {
        0: { cellWidth: 45 },
        1: { cellWidth: 32 },
        2: { cellWidth: 32 },
        3: { cellWidth: 38 },
        4: { cellWidth: 35 }
      },
      head: [['Transaction Category', 'Actual Paid', 'Settled Refund', 'Settlement Method', 'Bank Reference']],
      body: [
        [
          refundReason,
          `OMR ${actualReceived.toFixed(3)}`,
          `OMR ${refundAmount.toFixed(3)}`,
          settlementMethod,
          settlementRef
        ]
      ]
    });

    // Total Refund Box
    const tableFinalY = (doc as any).lastAutoTable?.finalY || 140;

    doc.setFillColor(240, 249, 244);
    doc.rect(120, tableFinalY + 6, 76, 20, 'F');
    doc.setDrawColor(15, 76, 42);
    doc.setLineWidth(0.3);
    doc.rect(120, tableFinalY + 6, 76, 20, 'S');

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 76, 42);
    doc.text("NET REFUND SETTLED", 125, tableFinalY + 13);

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 76, 42);
    doc.text(`OMR ${refundAmount.toFixed(3)}`, 125, tableFinalY + 22);

    // Remarks Section
    if (remarks) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(50, 50, 50);
      doc.text("FINANCE REMARKS & AUDIT NOTES", 14, tableFinalY + 12);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(80, 80, 80);
      const splitRemarks = doc.splitTextToSize(remarks, 100);
      doc.text(splitRemarks, 14, tableFinalY + 18);
    }

    // Legal & Audit Footer
    doc.setDrawColor(220, 220, 220);
    doc.line(14, 268, 196, 268);

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(130, 130, 130);
    doc.text("This is an official computer-generated refund settlement receipt issued by Greens Malayalee Kootayama (GMK) Finance.", 105, 274, { align: 'center' });
    doc.text("All disbursements are reconciled against registered bank statements and preserved for internal financial audit.", 105, 279, { align: 'center' });

    // Clean filename
    const cleanRef = gmkId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanDate = dateStr.replace(/[^a-zA-Z0-9_-]/g, '_');
    doc.save(`Refund_Settlement_${cleanRef}_${cleanDate}.pdf`);
  } catch (err) {
    console.error("Refund PDF Generation failed:", err);
  }
}

/**
 * Generates an official GMK Outstanding Registration Payables Report.
 * 
 * Heading: GMK OUTSTANDING REGISTRATION PAYABLES REPORT
 * Summarizes all unsettled/pending non-treasury payables (registration refunds).
 * Sourced dynamically with generation timestamp in Oman Time.
 */
export function generateOutstandingPayablesPDF(
  pendingRegistrations: EventRegistration[],
  eventsMap: Record<string, CommunityEvent> | CommunityEvent[],
  familiesList: Family[] = []
): void {
  try {
    const doc = new jsPDF('landscape');

    // Resolve event map
    const eventsById: Record<string, CommunityEvent> = Array.isArray(eventsMap)
      ? eventsMap.reduce((acc, ev) => { acc[ev.id] = ev; return acc; }, {} as Record<string, CommunityEvent>)
      : (eventsMap || {});

    // Calculate totals and rows
    let totalOutstanding = 0;
    const tableRows = pendingRegistrations.map((reg, index) => {
      const amtRec = Number(reg.amountReceived ?? (reg.paymentStatus === 'paid' ? (reg.amountDue ?? reg.paymentAmount ?? 0) : 0));
      const amtDue = Number(reg.amountDue ?? (reg.paymentStatus === 'cancelled' ? 0 : (reg.paymentAmount ?? 0)));
      const totalAlreadyRefunded = Number(reg.refundedAmount || 0);
      const netPaid = amtRec - totalAlreadyRefunded;
      const refundAmt = reg.refundDue || Math.max(0, netPaid - amtDue);
      totalOutstanding += refundAmt;

      const fam = familiesList.find(f => f.id === reg.familyId);
      const registrantName = reg.isExternal
        ? (reg.primaryRegistrantName || (reg.participants && reg.participants[0]) || reg.primaryMemberEmail || 'Guest')
        : (reg.primaryRegistrantName || (reg.participants && reg.participants[0]) || (fam ? fam.fullName : (reg.primaryMemberEmail ? reg.primaryMemberEmail.split('@')[0] : 'Member')));

      const gmkId = reg.isExternal
        ? (formatExternalGmkId(reg.publicReference) || formatExternalGmkId(reg.primaryMemberGmkId) || reg.publicReference || 'N/A')
        : (reg.primaryMemberGmkId || 'N/A');

      const categoryOrUnit = reg.isExternal
        ? (reg.externalRegistrationTypeName || 'External Guest')
        : (fam?.displayUnitNumber || reg.unitNumber || 'Resident');

      const ev = eventsById[reg.eventId];
      const eventName = ev ? getEventTitle(ev) : 'Community Event';

      const reason = reg.paymentStatus === 'cancelled' 
        ? 'Registration Cancellation' 
        : (amtRec > amtDue ? 'Overpayment / Downsize Adjustment' : 'Refund Pending');

      return [
        String(index + 1),
        registrantName,
        gmkId,
        categoryOrUnit,
        eventName,
        reason,
        `OMR ${refundAmt.toFixed(3)}`
      ];
    });

    // Timestamp in Oman Time
    const now = new Date();
    const dateFormatted = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeFormatted = now.toLocaleTimeString('en-GB', { 
      timeZone: 'Asia/Muscat', 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
    const omanTimestamp = `${dateFormatted} ${timeFormatted} (Oman Time)`;

    // Branding Header
    doc.setFillColor(15, 76, 42); // #0f4c2a
    doc.rect(0, 0, 297, 26, 'F');

    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text("GREENS MALAYALEE KOOTAYAMA", 14, 12);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(212, 175, 55);
    doc.text("COMMUNITY MANAGEMENT PLATFORM · FINANCE & TREASURY AUDIT", 14, 19);

    // Title Bar
    doc.setFillColor(245, 247, 245);
    doc.rect(14, 31, 269, 16, 'F');
    doc.setDrawColor(220, 225, 220);
    doc.rect(14, 31, 269, 16, 'S');

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 76, 42);
    doc.text("GMK OUTSTANDING REGISTRATION PAYABLES REPORT", 20, 41);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text(`Generated: ${omanTimestamp}`, 190, 41);

    // Summary Box
    doc.setFillColor(254, 243, 199); // Amber light
    doc.rect(14, 51, 269, 15, 'F');
    doc.setDrawColor(245, 158, 11);
    doc.setLineWidth(0.3);
    doc.rect(14, 51, 269, 15, 'S');

    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(146, 64, 14);
    doc.text(`Total Pending Payables: ${pendingRegistrations.length}`, 20, 61);
    doc.text(`Audit Category: Non-Treasury Event Registration Refunds`, 100, 61);
    doc.text(`Total Outstanding Amount: OMR ${totalOutstanding.toFixed(3)}`, 205, 61);

    // Table of Outstanding Payables
    autoTable(doc, {
      startY: 71,
      theme: 'grid',
      headStyles: {
        fillColor: [15, 76, 42],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.5
      },
      styles: {
        fontSize: 8,
        cellPadding: 3.5,
        textColor: [40, 40, 40]
      },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        1: { cellWidth: 55 },
        2: { cellWidth: 32, fontStyle: 'bold' },
        3: { cellWidth: 45 },
        4: { cellWidth: 50 },
        5: { cellWidth: 45 },
        6: { cellWidth: 30, halign: 'right', fontStyle: 'bold' }
      },
      head: [['#', 'Payee / Registrant', 'GMK ID', 'Category / Unit', 'Event Name', 'Refund Reason', 'Amount Due']],
      body: tableRows.length > 0 ? tableRows : [['-', 'No pending registration payables', '-', '-', '-', '-', 'OMR 0.000']],
      foot: [
        ['', 'TOTAL OUTSTANDING PAYABLES', '', '', '', `${pendingRegistrations.length} record(s)`, `OMR ${totalOutstanding.toFixed(3)}`]
      ],
      footStyles: {
        fillColor: [240, 249, 244],
        textColor: [15, 76, 42],
        fontStyle: 'bold',
        fontSize: 8.5
      }
    });

    const finalY = (doc as any).lastAutoTable?.finalY || 160;

    // Sign-off / Verification section
    if (finalY < 175) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(60, 60, 60);
      doc.text("VERIFICATION & SIGN-OFF:", 14, finalY + 12);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 100, 100);
      doc.text("Prepared By: Event Finance Desk", 14, finalY + 18);
      doc.text("Approved By: Event Director / Treasurer", 110, finalY + 18);
      doc.text("Disbursement Verification: Audit Committee", 200, finalY + 18);
    }

    // Legal Footer
    doc.setDrawColor(220, 220, 220);
    doc.line(14, 195, 283, 195);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(130, 130, 130);
    doc.text("Greens Malayalee Kootayama (GMK) Community Platform • Official Financial Audit Ledger", 148, 200, { align: 'center' });
    doc.text("Generated in accordance with non-treasury financial compliance rules. All disbursements require documented bank reconciliation.", 148, 204, { align: 'center' });

    const cleanDate = dateFormatted.replace(/[^a-zA-Z0-9_-]/g, '_');
    doc.save(`GMK_Outstanding_Payables_Report_${cleanDate}.pdf`);
  } catch (err) {
    console.error("Outstanding Payables PDF Generation failed:", err);
  }
}
