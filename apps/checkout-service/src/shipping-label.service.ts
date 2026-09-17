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

/** C1.45 — 100x150 mm termal printer uchun Elchi shipment yorlig‘i. */
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
    // 1 mm = 2.83465 pt; termal label standarti 100x150 mm.
    const width = 283.465;
    const height = 425.197;
    const margin = 16;
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
    doc
      .lineWidth(1)
      .rect(6, 6, width - 12, height - 12)
      .stroke();
    doc.font('Helvetica-Bold').fontSize(17).text('ELCHI', margin, 14, {
      width: 150,
    });
    doc.fontSize(9).text('YETKAZIB BERISH YORLIG‘I', margin, 36, {
      width: 155,
    });
    doc
      .font('Helvetica')
      .fontSize(8)
      .text(`Shipment: ${data.shipmentId}`, margin, 57)
      .text(`Buyurtma: ${data.salesOrderId}/${data.sellerOrderId}`, margin, 69);

    doc.image(qr, width - 104, 14, { width: 88, height: 88 });
    doc
      .font('Helvetica')
      .fontSize(5.5)
      .text(data.qrCodeToken, width - 108, 104, {
        width: 96,
        align: 'center',
      });

    doc
      .moveTo(margin, 122)
      .lineTo(width - margin, 122)
      .stroke();
    doc.font('Helvetica-Bold').fontSize(8).text('QABUL QILUVCHI', margin, 130);
    doc.fontSize(13).text(data.buyerName || 'Mijoz', margin, 144, {
      width: width - margin * 2,
      height: 32,
      ellipsis: true,
    });
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(data.buyerPhone || '-', margin, 178, {
        width: width - margin * 2,
      });
    doc.fontSize(9).text(data.deliveryAddress || '-', margin, 195, {
      width: width - margin * 2,
      height: 52,
      ellipsis: true,
    });

    doc
      .moveTo(margin, 253)
      .lineTo(width - margin, 253)
      .stroke();
    doc.font('Helvetica-Bold').fontSize(8).text('MAHSULOTLAR', margin, 261);
    const visibleItems = data.items.slice(0, 5);
    let y = 276;
    for (const item of visibleItems) {
      doc
        .font('Helvetica')
        .fontSize(8)
        .text(`${item.quantity} x ${item.productName}`, margin, y, {
          width: width - margin * 2,
          height: 16,
          ellipsis: true,
        });
      y += 17;
    }
    if (data.items.length > visibleItems.length) {
      doc
        .fontSize(7)
        .text(
          `+ yana ${data.items.length - visibleItems.length} ta pozitsiya`,
          margin,
          y,
        );
    }

    doc
      .moveTo(margin, 366)
      .lineTo(width - margin, 366)
      .stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('OLINADIGAN SUMMA (COD)', margin, 375, { width: 150 });
    doc.fontSize(15).text(this.money(data.codAmount), margin, 392, {
      width: width - margin * 2,
      align: 'right',
    });
  }

  private money(amount: number): string {
    return `${new Intl.NumberFormat('uz-UZ', {
      maximumFractionDigits: 2,
    }).format(amount)} UZS`;
  }
}
