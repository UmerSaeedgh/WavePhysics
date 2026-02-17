import jsPDF from 'jspdf';

export async function generateEquipmentPDF(equipment, completions, businessName, apiCall, logoImage = null) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  let yPos = margin;

  // Helper function to add a new page if needed (though we're aiming for one page)
  const checkPageBreak = (requiredSpace = 20) => {
    if (yPos + requiredSpace > pageHeight - margin) {
      doc.addPage();
      yPos = margin;
      return true;
    }
    return false;
  };

  // Helper function to load image and convert to base64
  const loadImageAsBase64 = (imagePath) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        try {
          const dataURL = canvas.toDataURL('image/png');
          resolve(dataURL);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = reject;
      img.src = imagePath;
    });
  };

  // Helper function to format dates
  const formatDateForPDF = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch (e) {
      return dateString;
    }
  };

  // Helper function to draw a light gray background for sections
  const drawSectionBackground = (startY, height) => {
    doc.setFillColor(248, 249, 250);
    doc.rect(margin, startY, pageWidth - 2 * margin, height, 'F');
  };

  // ========== HEADER SECTION ==========
  // Load and add logo
  let logoHeight = 0;
  let logoWidth = 0;
  try {
    let logoDataUrl = null;
    
    if (logoImage) {
      if (typeof logoImage === 'string' && logoImage.startsWith('data:')) {
        logoDataUrl = logoImage;
      } else if (logoImage instanceof HTMLImageElement) {
        const canvas = document.createElement('canvas');
        canvas.width = logoImage.naturalWidth || logoImage.width;
        canvas.height = logoImage.naturalHeight || logoImage.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(logoImage, 0, 0);
        logoDataUrl = canvas.toDataURL('image/png');
      } else {
        logoDataUrl = await loadImageAsBase64(logoImage);
      }
    } else {
      const logoImg = document.querySelector('img[src*="image.png"], img[alt*="Wave"], img[alt*="logo"], header img');
      if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = logoImg.naturalWidth || logoImg.width;
        canvas.height = logoImg.naturalHeight || logoImg.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(logoImg, 0, 0);
        logoDataUrl = canvas.toDataURL('image/png');
      }
    }

    if (logoDataUrl) {
      logoWidth = 30;
      logoHeight = 12;
      const logoX = margin;
      doc.addImage(logoDataUrl, 'PNG', logoX, yPos, logoWidth, logoHeight);
    }
  } catch (err) {
    console.warn('Could not load logo image:', err);
  }

  // Business name (next to logo, on the same line)
  const headerRightX = pageWidth - margin;
  const businessNameX = margin + logoWidth + 5;
  const businessNameY = logoHeight > 0 ? yPos + logoHeight / 2 - 2 : yPos;
  
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(businessName || 'Equipment Report', businessNameX, businessNameY);
  
  // Generated date (top right)
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated: ${formatDateForPDF(new Date().toISOString())}`, headerRightX, yPos + 2, { align: 'right' });
  
  // Title: Equipment Report (centered)
  yPos = businessNameY + 12;
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('Equipment Report', pageWidth / 2, yPos, { align: 'center' });
  
  yPos += 14;

  // ========== SECTION 1: EQUIPMENT OVERVIEW ==========
  const section1StartY = yPos;
  const section1Height = 55;
  drawSectionBackground(yPos - 2, section1Height);
  
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Equipment Overview', margin, yPos);
  yPos += 9;

  doc.setFontSize(9);
  const col1X = margin + 2;
  const col2X = pageWidth / 2 + 2;
  const labelWidth = 42;
  const valueOffset = 45;
  const rowHeight = 5.5;
  let col1Y = yPos;
  let col2Y = yPos;

  const equipmentFields = [
    ['Equipment Name:', equipment.equipment_name || 'N/A'],
    ['Equipment Type:', equipment.equipment_type_name || 'N/A'],
    ['Make:', equipment.make || 'N/A'],
    ['Model:', equipment.model || 'N/A'],
    ['Serial Number:', equipment.serial_number || 'N/A'],
    ['Anchor Date:', equipment.anchor_date ? formatDateForPDF(equipment.anchor_date) : 'N/A'],
    ['Due Date:', equipment.due_date ? formatDateForPDF(equipment.due_date) : 'N/A'],
    ['Interval:', equipment.interval_weeks ? `${equipment.interval_weeks} weeks` : 'N/A'],
    ['Lead Weeks:', equipment.lead_weeks ? `${equipment.lead_weeks}` : 'N/A'],
    ['Timezone:', equipment.timezone || 'N/A'],
  ];

  // Column 1 (first 4 items)
  equipmentFields.slice(0, 4).forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.text(label, col1X, col1Y);
    doc.setFont('helvetica', 'normal');
    const maxValueWidth = col2X - col1X - valueOffset;
    const valueLines = doc.splitTextToSize(value, maxValueWidth);
    doc.text(valueLines, col1X + valueOffset, col1Y);
    col1Y += Math.max(valueLines.length * 4, rowHeight);
  });

  // Column 2 (last 4 items)
  equipmentFields.slice(4).forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.text(label, col2X, col2Y);
    doc.setFont('helvetica', 'normal');
    const maxValueWidth = pageWidth - margin - col2X - valueOffset;
    const valueLines = doc.splitTextToSize(value, maxValueWidth);
    doc.text(valueLines, col2X + valueOffset, col2Y);
    col2Y += Math.max(valueLines.length * 4, rowHeight);
  });

  // Notes (full width, below columns)
  if (equipment.notes) {
    const notesY = Math.max(col1Y, col2Y) + 3;
    doc.setFont('helvetica', 'bold');
    doc.text('Notes:', margin + 2, notesY);
    doc.setFont('helvetica', 'normal');
    const notesLines = doc.splitTextToSize(equipment.notes, pageWidth - 2 * margin - 4);
    doc.text(notesLines, margin + 2, notesY + 4);
  }

  yPos = section1StartY + section1Height + 8;

  // ========== SECTION 2: CLIENT & SITE INFORMATION ==========
  const section2StartY = yPos;
  const section2Height = 48;
  drawSectionBackground(yPos - 2, section2Height);
  
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Client & Site Information', margin, yPos);
  yPos += 9;

  // Client Information (left side)
  const clientCardX = margin + 2;
  const cardWidth = (pageWidth - 2 * margin - 12) / 2;
  const siteCardX = clientCardX + cardWidth + 8;
  const labelOffset = 20;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Client Information', clientCardX, yPos);
  let clientY = yPos + 6;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');

  if (equipment.client_name) {
    doc.setFont('helvetica', 'bold');
    doc.text('Name:', clientCardX, clientY);
    doc.setFont('helvetica', 'normal');
    const nameLines = doc.splitTextToSize(equipment.client_name, cardWidth - labelOffset);
    doc.text(nameLines, clientCardX + labelOffset, clientY);
    clientY += Math.max(nameLines.length * 3.8, 5);
  }

  if (equipment.client_address) {
    doc.setFont('helvetica', 'bold');
    doc.text('Address:', clientCardX, clientY);
    doc.setFont('helvetica', 'normal');
    const addrLines = doc.splitTextToSize(equipment.client_address, cardWidth - labelOffset);
    doc.text(addrLines, clientCardX + labelOffset, clientY);
    clientY += Math.max(addrLines.length * 3.8, 5);
  }

  if (equipment.client_billing_info) {
    doc.setFont('helvetica', 'bold');
    doc.text('Billing:', clientCardX, clientY);
    doc.setFont('helvetica', 'normal');
    const billingLines = doc.splitTextToSize(equipment.client_billing_info, cardWidth - labelOffset);
    doc.text(billingLines, clientCardX + labelOffset, clientY);
    clientY += Math.max(billingLines.length * 3.8, 5);
  }

  if (equipment.client_notes) {
    doc.setFont('helvetica', 'bold');
    doc.text('Notes:', clientCardX, clientY);
    clientY += 4;
    doc.setFont('helvetica', 'normal');
    const notesLines = doc.splitTextToSize(equipment.client_notes, cardWidth - 2);
    doc.text(notesLines, clientCardX, clientY);
    clientY += notesLines.length * 3.8;
  }

  // Site Information (right side)
  let siteY = yPos + 6;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Site Information', siteCardX, yPos);
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');

  if (equipment.site_name) {
    doc.setFont('helvetica', 'bold');
    doc.text('Name:', siteCardX, siteY);
    doc.setFont('helvetica', 'normal');
    const nameLines = doc.splitTextToSize(equipment.site_name, cardWidth - labelOffset);
    doc.text(nameLines, siteCardX + labelOffset, siteY);
    siteY += Math.max(nameLines.length * 3.8, 5);
  }

  if (equipment.site_street) {
    doc.setFont('helvetica', 'bold');
    doc.text('Street:', siteCardX, siteY);
    doc.setFont('helvetica', 'normal');
    const streetLines = doc.splitTextToSize(equipment.site_street, cardWidth - labelOffset);
    doc.text(streetLines, siteCardX + labelOffset, siteY);
    siteY += Math.max(streetLines.length * 3.8, 5);
  }

  if (equipment.site_state) {
    doc.setFont('helvetica', 'bold');
    doc.text('State:', siteCardX, siteY);
    doc.setFont('helvetica', 'normal');
    doc.text(equipment.site_state, siteCardX + labelOffset, siteY);
    siteY += 5;
  }

  if (equipment.site_registration_license) {
    doc.setFont('helvetica', 'bold');
    doc.text('Reg/License:', siteCardX, siteY);
    doc.setFont('helvetica', 'normal');
    const regLines = doc.splitTextToSize(equipment.site_registration_license, cardWidth - labelOffset);
    doc.text(regLines, siteCardX + labelOffset, siteY);
    siteY += Math.max(regLines.length * 3.8, 5);
  }

  if (equipment.site_timezone) {
    doc.setFont('helvetica', 'bold');
    doc.text('Timezone:', siteCardX, siteY);
    doc.setFont('helvetica', 'normal');
    doc.text(equipment.site_timezone, siteCardX + labelOffset, siteY);
    siteY += 5;
  }

  if (equipment.site_notes) {
    doc.setFont('helvetica', 'bold');
    doc.text('Notes:', siteCardX, siteY);
    siteY += 4;
    doc.setFont('helvetica', 'normal');
    const notesLines = doc.splitTextToSize(equipment.site_notes, cardWidth - 2);
    doc.text(notesLines, siteCardX, siteY);
    siteY += notesLines.length * 3.8;
  }

  yPos = section2StartY + section2Height + 8;

  // ========== SECTION 3: TESTING HISTORY ==========
  const section3StartY = yPos;
  const remainingSpace = pageHeight - yPos - 20; // Leave space for footer
  
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Testing History', margin, yPos);
  yPos += 9;

  if (!completions || completions.length === 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(120, 120, 120);
    doc.text('This equipment has not been tested so far.', margin, yPos);
    doc.setTextColor(0, 0, 0);
  } else {
    // Table header
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    const tableTopY = yPos;
    const colWidths = [10, 42, 42, 28, 38];
    const headers = ['#', 'Completed Date', 'Due Date', 'Interval', 'Completed By'];
    let xPos = margin + 2;
    const headerY = yPos;

    headers.forEach((header, index) => {
      doc.text(header, xPos, headerY);
      xPos += colWidths[index];
    });
    yPos += 5.5;

    // Draw header underline
    doc.setLineWidth(0.3);
    doc.setDrawColor(200, 200, 200);
    doc.line(margin + 2, yPos - 1, pageWidth - margin - 2, yPos - 1);
    yPos += 3;

    // Table rows
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const maxRows = Math.floor((remainingSpace - 15) / 5.5); // Calculate max rows that fit
    const rowsToShow = Math.min(completions.length, maxRows);
    
    completions.slice(0, rowsToShow).forEach((completion, index) => {
      const rowData = [
        (index + 1).toString(),
        completion.completed_at ? formatDateForPDF(completion.completed_at) : 'N/A',
        completion.due_date ? formatDateForPDF(completion.due_date) : 'N/A',
        completion.interval_weeks ? `${completion.interval_weeks}w` : 'N/A',
        completion.completed_by_user || 'N/A'
      ];

      xPos = margin + 2;
      rowData.forEach((cell, cellIndex) => {
        const cellLines = doc.splitTextToSize(cell, colWidths[cellIndex] - 3);
        doc.text(cellLines, xPos, yPos);
        xPos += colWidths[cellIndex];
      });
      yPos += 5.5;
    });

    // Summary
    yPos += 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`Total Completions: ${completions.length}`, margin, yPos);
    
    if (completions.length > rowsToShow) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(`(Showing first ${rowsToShow} of ${completions.length})`, margin + 50, yPos);
      doc.setTextColor(0, 0, 0);
    }
  }

  // ========== FOOTER ==========
  const footerY = pageHeight - 8;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(150, 150, 150);
  doc.text(`Generated on ${formatDateForPDF(new Date().toISOString())}`, pageWidth / 2, footerY, { align: 'center' });
  doc.setTextColor(0, 0, 0);

  // ========== FINALIZE ==========
  // Open PDF in new window for printing instead of downloading
  const pdfBlob = doc.output('blob');
  const pdfUrl = URL.createObjectURL(pdfBlob);
  const printWindow = window.open(pdfUrl, '_blank');
  
  // Wait for the PDF to load, then trigger print dialog
  if (printWindow) {
    printWindow.onload = () => {
      // Small delay to ensure PDF is fully loaded
      setTimeout(() => {
        printWindow.print();
        // Clean up the blob URL after printing
        printWindow.onbeforeunload = () => {
          URL.revokeObjectURL(pdfUrl);
        };
      }, 250);
    };
  } else {
    // Fallback: if popup is blocked, download the file
    const fileName = `Equipment_Report_${equipment.equipment_name || equipment.id}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
  }
}
