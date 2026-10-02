import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  NotificationTemplateDto,
  UpdateNotificationTemplateDto,
} from '@app/common';
import { Repository } from 'typeorm';
import { NotificationTemplate } from './entities/notification-template.entity';
import {
  isTemplateKey,
  NOTIFICATION_TEMPLATES,
  placeholders,
  renderTemplate,
  stripPlaceholders,
  TemplateKey,
} from './notification-templates';

/**
 * C6.8 — shablonlar. Har xabarda bazadan o'qiladi (kesh yo'q): admin
 * tahrirlagan matn KEYINGI xabardayoq ishlatiladi. Xabarlar soni kichik,
 * bitta PK bo'yicha so'rov arzon.
 */
@Injectable()
export class NotificationTemplateService {
  constructor(
    @InjectRepository(NotificationTemplate)
    private readonly templates: Repository<NotificationTemplate>,
  ) {}

  async list(): Promise<NotificationTemplateDto[]> {
    const overrides = new Map(
      (await this.templates.find()).map((row) => [row.key, row]),
    );
    return (Object.keys(NOTIFICATION_TEMPLATES) as TemplateKey[]).map((key) =>
      this.toDto(key, overrides.get(key)),
    );
  }

  async update(
    key: string,
    dto: UpdateNotificationTemplateDto,
    actorId?: string | null,
  ): Promise<NotificationTemplateDto> {
    const templateKey = this.known(key);
    const title = dto.title.trim();
    const body = dto.body.trim();
    if (!title || !body)
      throw new BadRequestException('Sarlavha va matn bo‘sh bo‘lmasin');
    const allowed = Object.keys(NOTIFICATION_TEMPLATES[templateKey].variables);
    const unknown = [
      ...new Set([...placeholders(title), ...placeholders(body)]),
    ].filter((name) => !allowed.includes(name));
    if (unknown.length) {
      throw new BadRequestException(
        `Noma’lum o‘zgaruvchi: ${unknown.map((name) => `{${name}}`).join(', ')}. ` +
          `Mumkin: ${allowed.map((name) => `{${name}}`).join(', ')}`,
      );
    }
    // `{{shopName}}` yoki yopilmagan `{` render'da xom qavs bo'lib chiqadi.
    if ([title, body].some((text) => /[{}]/.test(stripPlaceholders(text)))) {
      throw new BadRequestException(
        'Ortiqcha { yoki } belgisi bor — o‘zgaruvchini bitta qavsda yozing: ' +
          allowed.map((name) => `{${name}}`).join(', '),
      );
    }
    const saved = await this.templates.save(
      this.templates.create({
        key: templateKey,
        title,
        body,
        updatedBy: actorId ? String(actorId) : null,
      }),
    );
    return this.toDto(templateKey, saved);
  }

  /** Standart matnga qaytarish — tahrirlangan yozuv o'chiriladi. */
  async reset(key: string): Promise<NotificationTemplateDto> {
    const templateKey = this.known(key);
    await this.templates.delete({ key: templateKey });
    return this.toDto(templateKey, undefined);
  }

  /** Xabar matni: tahrirlangan bo'lsa u, aks holda standart. */
  async render(
    key: TemplateKey,
    values: Record<string, unknown>,
  ): Promise<{ title: string; body: string }> {
    const override = await this.templates.findOneBy({ key });
    const source = override ?? NOTIFICATION_TEMPLATES[key];
    return {
      title: renderTemplate(source.title, values),
      body: renderTemplate(source.body, values),
    };
  }

  private known(key: string): TemplateKey {
    if (!isTemplateKey(key)) throw new NotFoundException('Shablon topilmadi');
    return key;
  }

  private toDto(
    key: TemplateKey,
    override: NotificationTemplate | undefined,
  ): NotificationTemplateDto {
    const definition = NOTIFICATION_TEMPLATES[key];
    return {
      key,
      name: definition.name,
      description: definition.description,
      variables: definition.variables,
      title: override?.title ?? definition.title,
      body: override?.body ?? definition.body,
      customized: Boolean(override),
      defaultTitle: definition.title,
      defaultBody: definition.body,
      updatedAt: override?.updatedAt
        ? new Date(override.updatedAt).toISOString()
        : null,
    };
  }
}
