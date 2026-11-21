import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LeadOrderStatus, WarehouseReturnView } from '@app/common';

const ID = /^[1-9]\d{0,18}$/;

/**
 * BE-17 (TZ OMB-6, T5 «RETURNING → RETURNED_GRADED — omborchi»): omborga qaytayotgan lid posilkalari va saralash
 * uchun buyurtma ma’lumoti (posilka, Elchi raqami, tovarlar).
 */
@Injectable()
export class WarehouseReturnsService {
  constructor(private readonly dataSource: DataSource) {}

  async list(): Promise<WarehouseReturnView[]> {
    const orders = (await this.dataSource.query(
      `SELECT o.id::text AS "orderId", o.status, p.id::text AS "parcelId",
              p.elchi_shipment_id::text AS "shipmentId", p.tracking_url AS "trackingUrl", o.updated_at AS "updatedAt"
         FROM checkout.sales_order o
         JOIN checkout.parcel p ON p.sales_order_id = o.id
        WHERE o.source IS NOT NULL AND o.status = $1
        ORDER BY o.updated_at, o.id
        LIMIT 200`,
      [LeadOrderStatus.RETURNING],
    )) as Array<Omit<WarehouseReturnView, 'items'>>;
    return this.withItems(orders);
  }

  async info(input: { orderId: string }): Promise<WarehouseReturnView> {
    const orderId = String(input?.orderId ?? '');
    if (!ID.test(orderId)) throw new NotFoundException('Buyurtma topilmadi');
    const orders = (await this.dataSource.query(
      `SELECT o.id::text AS "orderId", o.status, p.id::text AS "parcelId",
              p.elchi_shipment_id::text AS "shipmentId", p.tracking_url AS "trackingUrl", o.updated_at AS "updatedAt"
         FROM checkout.sales_order o
         JOIN checkout.parcel p ON p.sales_order_id = o.id
        WHERE o.id = $1 AND o.source IS NOT NULL`,
      [orderId],
    )) as Array<Omit<WarehouseReturnView, 'items'>>;
    if (!orders.length) throw new NotFoundException('Buyurtma topilmadi');
    return (await this.withItems(orders))[0];
  }

  private async withItems(
    orders: Array<Omit<WarehouseReturnView, 'items'>>,
  ): Promise<WarehouseReturnView[]> {
    if (!orders.length) return [];
    const items = (await this.dataSource.query(
      `SELECT p.sales_order_id::text AS "orderId", i.variant_id::text AS "variantId",
              i.product_name AS "productName", i.sku, i.barcode, i.quantity
         FROM checkout.sales_order_item i
         JOIN checkout.parcel p ON p.id = i.sales_order_seller_id
        WHERE p.sales_order_id = ANY($1::bigint[])
        ORDER BY i.id`,
      [orders.map((order) => order.orderId)],
    )) as Array<WarehouseReturnView['items'][number] & { orderId: string }>;
    return orders.map((order) => ({
      ...order,
      items: items
        .filter((item) => item.orderId === order.orderId)
        .map((item) => ({
          variantId: item.variantId,
          productName: item.productName,
          sku: item.sku,
          barcode: item.barcode,
          quantity: Number(item.quantity),
        })),
    }));
  }
}
