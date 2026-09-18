import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface ShippingLabelData {
  sellerOrderId: string;
  salesOrderId: string;
  shipmentId: string;
  qrCodeToken: string;
  buyerName: string;
  buyerPhone: string;
  deliveryAddress: string;
  codAmount: number;
  items: Array<{ productName: string; quantity: number }>;
}

export interface ShippingLabelDocument {
  fileName: string;
  contentType: 'application/pdf';
  base64: string;
}

/** C1.45 — Gainscha GS-2408D uchun 100x60 mm Elchi shipment yorlig‘i. */
@Injectable()
export class ShippingLabelService {
  async generate(data: ShippingLabelData): Promise<ShippingLabelDocument> {
    const pdf = await this.renderBatch([data]);
    return {
      fileName: `shipment-${data.shipmentId}.pdf`,
      contentType: 'application/pdf',
      base64: pdf.toString('base64'),
    };
  }

  async generateBatch(
    labels: ShippingLabelData[],
  ): Promise<ShippingLabelDocument> {
    if (labels.length === 0) {
      throw new Error('Kamida bitta yorliq kerak');
    }
    const pdf = await this.renderBatch(labels);
    return {
      fileName: `shipments-${labels.length}.pdf`,
      contentType: 'application/pdf',
      base64: pdf.toString('base64'),
    };
  }

  private async renderBatch(labels: ShippingLabelData[]): Promise<Buffer> {
    // 1 mm = 2.83465 pt; Elchi termal printer standarti 100x60 mm landscape.
    const width = 283.465;
    const height = 170.079;
    const margin = 6;
    const qrCodes = await Promise.all(
      labels.map((data) =>
        QRCode.toBuffer(data.qrCodeToken, {
          type: 'png',
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 220,
        }),
      ),
    );
    const doc = new PDFDocument({
      size: [width, height],
      margin,
      compress: false,
      info: {
        Title: `Elchi shipment labels (${labels.length})`,
        Subject: 'Marketplace seller order labels',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const completed = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    labels.forEach((data, index) => {
      if (index > 0) doc.addPage({ size: [width, height], margin });
      this.drawPage(doc, data, qrCodes[index], width, height, margin);
    });

    doc.end();
    return completed;
  }

  private drawPage(
    doc: PDFKit.PDFDocument,
    data: ShippingLabelData,
    qr: Buffer,
    width: number,
    height: number,
    margin: number,
  ): void {
    const leftWidth = 80;
    const rightX = margin + leftWidth + 5;
    const rightWidth = width - rightX - margin;

    doc
      .lineWidth(0.7)
      .rect(3, 3, width - 6, height - 6)
      .stroke();
    doc
      .moveTo(rightX - 3, margin)
      .lineTo(rightX - 3, height - margin)
      .stroke();

    // Chap panel: brend, skanerlanadigan QR va identifikatorlar.
    doc.font('Helvetica-Bold').fontSize(13).text('ELCHI', margin, 7, {
      width: leftWidth,
      align: 'center',
      lineBreak: false,
    });
    doc.image(qr, margin + 9, 24, { width: 62, height: 62 });
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .text(`Shipment: ${data.shipmentId}`, margin, 90, {
        width: leftWidth,
        align: 'center',
        height: 9,
        ellipsis: true,
        lineBreak: false,
      })
      .text(`Order: ${data.salesOrderId}/${data.sellerOrderId}`, margin, 101, {
        width: leftWidth,
        align: 'center',
        height: 9,
        ellipsis: true,
        lineBreak: false,
      });
    doc.font('Helvetica').fontSize(4.5).text(data.qrCodeToken, margin, 113, {
      width: leftWidth,
      height: 20,
      align: 'center',
      ellipsis: true,
    });

    // O‘ng panel: qabul qiluvchi va manzil.
    doc.font('Helvetica-Bold').fontSize(6).text('QABUL QILUVCHI', rightX, 7, {
      lineBreak: false,
    });
    doc.fontSize(10).text(data.buyerName || 'Mijoz', rightX, 16, {
      width: rightWidth,
      height: 13,
      ellipsis: true,
      lineBreak: false,
    });
    doc
      .font('Helvetica')
      .fontSize(8)
      .text(data.buyerPhone || '-', rightX, 31, {
        width: rightWidth,
        height: 10,
        ellipsis: true,
        lineBreak: false,
      });
    doc.fontSize(7).text(data.deliveryAddress || '-', rightX, 43, {
      width: rightWidth,
      height: 20,
      ellipsis: true,
    });

    doc
      .moveTo(rightX, 66)
      .lineTo(width - margin, 66)
      .stroke();
    doc.font('Helvetica-Bold').fontSize(6).text('MAHSULOTLAR', rightX, 70, {
      lineBreak: false,
    });
    const visibleItems = data.items.slice(0, 4);
    let itemY = 80;
    for (const item of visibleItems) {
      doc
        .font('Helvetica')
        .fontSize(6.5)
        .text(`${item.quantity} x ${item.productName}`, rightX, itemY, {
          width: rightWidth,
          height: 9,
          ellipsis: true,
          lineBreak: false,
        });
      itemY += 10;
    }
    if (data.items.length > visibleItems.length) {
      doc
        .fontSize(6)
        .text(
          `+ yana ${data.items.length - visibleItems.length} ta pozitsiya`,
          rightX,
          120,
          { width: rightWidth, height: 8, lineBreak: false },
        );
    }

    doc
      .moveTo(rightX, 131)
      .lineTo(width - margin, 131)
      .stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .text('OLINADIGAN SUMMA (COD)', rightX, 135, {
        width: rightWidth,
        height: 9,
        lineBreak: false,
      });
    doc.fontSize(12).text(this.money(data.codAmount), rightX, 147, {
      width: rightWidth,
      align: 'right',
      height: 15,
      lineBreak: false,
    });
  }

  private money(amount: number): string {
    return `${new Intl.NumberFormat('uz-UZ', {
      maximumFractionDigits: 2,
    }).format(amount)} UZS`;
  }
}
