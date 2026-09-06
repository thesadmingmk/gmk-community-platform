import QRCode from 'qrcode';

export interface EntryPassRenderOptions {
  entryPassNumber: string;
  eventName: string;
  eventDate?: string;
  eventVenue?: string;
  registrantName?: string;
  totalAttendees?: number;
  gmkId?: string;
  referenceId?: string;
  width?: number;
  height?: number;
}

/**
 * Draws the official GMK vector logo directly onto the canvas context.
 * Features the forest-green rounded square and three gold sparkle stars.
 */
function drawGMKLogoOnCanvas(
  ctx: CanvasRenderingContext2D, 
  x: number, 
  y: number, 
  size: number
) {
  ctx.save();
  ctx.translate(x, y);

  // 1. Background gradient rounded-square
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#0f4c2a');
  grad.addColorStop(1, '#125831');
  ctx.fillStyle = grad;

  const radius = size * 0.28;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(0, 0, size, size, radius);
  } else {
    // Fallback for older canvas implementations
    ctx.rect(0, 0, size, size);
  }
  ctx.fill();

  // Scale factor based on standard 64x64 viewBox
  const s = size / 64;

  // 2. Main Gold Sparkle Star (#d4af37)
  ctx.fillStyle = '#d4af37';
  ctx.beginPath();
  ctx.moveTo(32 * s, 10 * s);
  ctx.lineTo(35.8 * s, 24.2 * s);
  ctx.lineTo(50 * s, 28 * s);
  ctx.lineTo(35.8 * s, 31.8 * s);
  ctx.lineTo(32 * s, 46 * s);
  ctx.lineTo(28.2 * s, 31.8 * s);
  ctx.lineTo(14 * s, 28 * s);
  ctx.lineTo(28.2 * s, 24.2 * s);
  ctx.closePath();
  ctx.fill();

  // 3. Secondary Light Gold Sparkle Star (#f0d375)
  ctx.fillStyle = '#f0d375';
  ctx.beginPath();
  ctx.moveTo(47 * s, 38 * s);
  ctx.lineTo(48.8 * s, 44.2 * s);
  ctx.lineTo(55 * s, 46 * s);
  ctx.lineTo(48.8 * s, 47.8 * s);
  ctx.lineTo(47 * s, 54 * s);
  ctx.lineTo(45.2 * s, 47.8 * s);
  ctx.lineTo(39 * s, 46 * s);
  ctx.lineTo(45.2 * s, 44.2 * s);
  ctx.closePath();
  ctx.fill();

  // 4. Accent Gold Sparkle Star (#d4af37 with 0.8 opacity)
  ctx.fillStyle = 'rgba(212, 175, 55, 0.8)';
  ctx.beginPath();
  ctx.moveTo(18 * s, 12 * s);
  ctx.lineTo(19.2 * s, 16.8 * s);
  ctx.lineTo(24 * s, 18 * s);
  ctx.lineTo(19.2 * s, 19.2 * s);
  ctx.lineTo(18 * s, 24 * s);
  ctx.lineTo(16.8 * s, 19.2 * s);
  ctx.lineTo(12 * s, 18 * s);
  ctx.lineTo(16.8 * s, 16.8 * s);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/**
 * Helper to wrap text cleanly onto canvas
 */
function wrapText(
  ctx: CanvasRenderingContext2D, 
  text: string, 
  x: number, 
  y: number, 
  maxWidth: number, 
  lineHeight: number
): number {
  const words = text.split(' ');
  let line = '';
  let currentY = y;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    if (testWidth > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, currentY);
      line = words[n] + ' ';
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), x, currentY);
  return currentY + lineHeight;
}

/**
 * Generates an HTML5 Canvas containing the Official GMK Entry Pass visual.
 * 
 * STRICT COMPLIANCE:
 * - QR payload is EXACTLY the entryPassNumber.
 * - ZERO financial information included.
 * - Dynamic event name and GMK branding.
 */
export async function generateEntryPassCanvas(
  options: EntryPassRenderOptions
): Promise<HTMLCanvasElement> {
  const canvasWidth = options.width || 640;
  const canvasHeight = options.height || 920;

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas context for Entry Pass generation.');
  }

  // 1. Background fill
  ctx.fillStyle = '#fbf9f4'; // Warm off-white neutral
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // 2. Outer Card with Forest Green & Gold Accents
  const cardMargin = 20;
  const cardWidth = canvasWidth - (cardMargin * 2);
  const cardHeight = canvasHeight - (cardMargin * 2);
  const cardRadius = 24;

  // Card shadow / border
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e7e5e0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(cardMargin, cardMargin, cardWidth, cardHeight, cardRadius);
  } else {
    ctx.rect(cardMargin, cardMargin, cardWidth, cardHeight);
  }
  ctx.fill();
  ctx.stroke();

  // Top header background banner
  const headerHeight = 110;
  ctx.fillStyle = '#0f4c2a';
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(cardMargin, cardMargin, cardWidth, headerHeight, [cardRadius, cardRadius, 0, 0]);
  } else {
    ctx.rect(cardMargin, cardMargin, cardWidth, headerHeight);
  }
  ctx.fill();

  // Gold separator line below header
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cardMargin, cardMargin + headerHeight);
  ctx.lineTo(cardMargin + cardWidth, cardMargin + headerHeight);
  ctx.stroke();

  // 3. TOP: GMK Logo and Identity
  const logoSize = 64;
  const logoX = cardMargin + 24;
  const logoY = cardMargin + ((headerHeight - logoSize) / 2);
  drawGMKLogoOnCanvas(ctx, logoX, logoY, logoSize);

  // Header Typography
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 19px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('GREENS MALAYALEE KOOTAYAMA', logoX + logoSize + 16, cardMargin + 48);

  ctx.fillStyle = '#d4af37';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('AL HAIL GREENS COMMUNITY • GATHERING PASS', logoX + logoSize + 16, cardMargin + 72);

  ctx.restore();

  // 4. MIDDLE: Dynamic Event Name
  ctx.save();
  ctx.textAlign = 'center';
  const centerX = canvasWidth / 2;

  let currentY = cardMargin + headerHeight + 45;

  // Event Name
  ctx.fillStyle = '#0f4c2a';
  ctx.font = 'bold 24px sans-serif';
  currentY = wrapText(ctx, (options.eventName || 'Community Gathering').toUpperCase(), centerX, currentY, cardWidth - 60, 30);

  // "OFFICIAL ENTRY PASS" Badge
  currentY += 8;
  const badgeWidth = 260;
  const badgeHeight = 32;
  ctx.fillStyle = '#f4efe3';
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(centerX - (badgeWidth / 2), currentY - 22, badgeWidth, badgeHeight, 8);
  } else {
    ctx.rect(centerX - (badgeWidth / 2), currentY - 22, badgeWidth, badgeHeight);
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#0f4c2a';
  ctx.font = 'bold 12px monospace';
  ctx.fillText('★ OFFICIAL ENTRY PASS ★', centerX, currentY);

  // 5. QR CODE: Generated strictly from options.entryPassNumber
  currentY += 28;
  const qrSize = 250;
  const qrDataUrl = await QRCode.toDataURL(options.entryPassNumber, {
    margin: 1,
    width: qrSize,
    color: {
      dark: '#0f4c2a',
      light: '#ffffff'
    }
  });

  const qrImage = new Image();
  await new Promise<void>((resolve, reject) => {
    qrImage.onload = () => resolve();
    qrImage.onerror = (e) => reject(e);
    qrImage.src = qrDataUrl;
  });

  // QR Code Frame
  const qrFrameSize = qrSize + 20;
  const qrX = centerX - (qrSize / 2);
  const qrY = currentY;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e2ded5';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(centerX - (qrFrameSize / 2), qrY - 10, qrFrameSize, qrFrameSize, 14);
  } else {
    ctx.rect(centerX - (qrFrameSize / 2), qrY - 10, qrFrameSize, qrFrameSize);
  }
  ctx.fill();
  ctx.stroke();

  // Draw QR Image
  ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

  currentY += qrSize + 24;

  // 6. ENTRY PASS NUMBER: Bold Monospace
  ctx.fillStyle = '#1c1917';
  ctx.font = '900 20px monospace';
  ctx.fillText(options.entryPassNumber, centerX, currentY);

  // 7. Optional Attendee and Household metadata
  currentY += 28;
  ctx.fillStyle = '#57534e';
  ctx.font = 'bold 13px sans-serif';

  const attendeeLines: string[] = [];
  if (options.registrantName) {
    attendeeLines.push(`Registrant: ${options.registrantName}`);
  }
  if (options.totalAttendees && options.totalAttendees > 0) {
    attendeeLines.push(`Admit: ${options.totalAttendees} ${options.totalAttendees === 1 ? 'Attendee' : 'Attendees'}`);
  }
  if (options.gmkId) {
    attendeeLines.push(`GMK ID: ${options.gmkId}`);
  } else if (options.referenceId) {
    attendeeLines.push(`Ref: ${options.referenceId}`);
  }

  if (attendeeLines.length > 0) {
    ctx.fillText(attendeeLines.join('  •  '), centerX, currentY);
    currentY += 20;
  }

  if (options.eventDate) {
    ctx.fillStyle = '#78716c';
    ctx.font = 'normal 12px sans-serif';
    ctx.fillText(options.eventDate, centerX, currentY);
    currentY += 18;
  }

  // 8. BOTTOM: Community Identity & Gate Instructions
  const bottomY = canvasHeight - cardMargin - 32;
  ctx.fillStyle = '#78716c';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText('Present this QR Code or Entry Pass at the event gate for instant admission.', centerX, bottomY);

  ctx.fillStyle = '#a8a29e';
  ctx.font = 'normal 10px monospace';
  ctx.fillText('Greens Malayalee Kootayama (GMK) Community Micro ERP', centerX, bottomY + 16);

  ctx.restore();

  return canvas;
}

/**
 * Export Entry Pass directly to a high-resolution PNG data URL.
 */
export async function generateEntryPassDataUrl(
  options: EntryPassRenderOptions
): Promise<string> {
  const canvas = await generateEntryPassCanvas(options);
  return canvas.toDataURL('image/png');
}

/**
 * Export Entry Pass directly to a Blob for downloading or cloud uploading.
 */
export async function generateEntryPassBlob(
  options: EntryPassRenderOptions
): Promise<Blob> {
  const canvas = await generateEntryPassCanvas(options);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to generate Blob from Entry Pass Canvas'));
      }
    }, 'image/png');
  });
}

/**
 * Triggers a browser download of the Entry Pass PNG image.
 */
export async function downloadEntryPassImage(
  options: EntryPassRenderOptions, 
  filename?: string
): Promise<void> {
  const dataUrl = await generateEntryPassDataUrl(options);
  const cleanFilename = filename || `GMK_Entry_Pass_${options.entryPassNumber}.png`;
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = cleanFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
